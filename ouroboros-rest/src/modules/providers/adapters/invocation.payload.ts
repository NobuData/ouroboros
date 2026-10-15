/**
 * The worker's payload, in each wire format's dialect — AF.2
 * ([#235](https://github.com/NobuData/ouroboros/issues/235)).
 *
 * A worker names an alias, not a provider, so it cannot know whether hop 1 is Anthropic and
 * hop 2 is an Ollama. Every engine caller therefore sends one common chat shape:
 *
 * ```
 * { system?: string, messages: [{role, content}], max_output_tokens?: number, …rest }
 * ```
 *
 * and each format gets only what it needs moved: Anthropic wants `system` on its own and a
 * `max_tokens`; OpenAI and Ollama want the system prompt as the first message; Ollama wants
 * sampling under `options`. Every other field passes through unread
 * (`invoke.contract.ts` decision 2), and `model` and `stream` are always the adapter's.
 */

/** The output ceiling Anthropic requires when the caller sent none. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

/** The fields this module reads; everything else passes through. */
const COMMON_FIELDS = ["system", "messages", "max_output_tokens", "max_tokens", "model", "stream"];

/** Sampling fields Ollama reads under `options` rather than at the top level. */
const OLLAMA_OPTION_FIELDS = ["temperature", "top_p", "top_k", "seed", "stop"];

/** The common shape, taken apart. */
interface ChatParts {
  readonly system: string | null;
  readonly messages: readonly unknown[];
  readonly maxOutputTokens: number | null;
  readonly rest: Record<string, unknown>;
}

/**
 * Take the common fields off a payload.
 *
 * @param payload - The worker's payload with the hop's params merged over it.
 * @returns The parts. `max_tokens` is accepted as a synonym for `max_output_tokens`.
 */
function partsOf(payload: Readonly<Record<string, unknown>>): ChatParts {
  const rest: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (!COMMON_FIELDS.includes(key)) {
      rest[key] = value;
    }
  }

  const max = payload.max_output_tokens ?? payload.max_tokens;

  return {
    system: typeof payload.system === "string" ? payload.system : null,
    messages: Array.isArray(payload.messages) ? (payload.messages as unknown[]) : [],
    maxOutputTokens: typeof max === "number" && Number.isInteger(max) && max > 0 ? max : null,
    rest,
  };
}

/**
 * The messages with the system prompt as the first one, for the formats that put it there.
 *
 * @param parts - The payload's parts.
 * @returns The messages.
 */
function withSystemMessage(parts: ChatParts): unknown[] {
  return parts.system === null
    ? [...parts.messages]
    : [{ role: "system", content: parts.system }, ...parts.messages];
}

/**
 * An Anthropic Messages request body.
 *
 * @param modelId - The hop's model.
 * @param payload - The merged payload.
 * @returns The body, streaming.
 */
export function anthropicBody(
  modelId: string,
  payload: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const parts = partsOf(payload);

  return {
    ...parts.rest,
    ...(parts.system === null ? {} : { system: parts.system }),
    messages: parts.messages,
    max_tokens: parts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    model: modelId,
    stream: true,
  };
}

/**
 * An OpenAI chat-completions request body, asking for streamed usage explicitly.
 *
 * @param modelId - The hop's model.
 * @param payload - The merged payload.
 * @returns The body, streaming, with `stream_options.include_usage` on.
 */
export function openAiBody(
  modelId: string,
  payload: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const parts = partsOf(payload);
  const options = parts.rest.stream_options;

  return {
    ...parts.rest,
    messages: withSystemMessage(parts),
    ...(parts.maxOutputTokens === null ? {} : { max_tokens: parts.maxOutputTokens }),
    model: modelId,
    stream: true,
    stream_options: {
      ...(typeof options === "object" && options !== null ? options : {}),
      include_usage: true,
    },
  };
}

/**
 * An Ollama `/api/chat` request body.
 *
 * @param modelId - The hop's model.
 * @param payload - The merged payload.
 * @returns The body, streaming, with sampling and the output ceiling under `options`.
 */
export function ollamaBody(
  modelId: string,
  payload: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const parts = partsOf(payload);
  const given = parts.rest.options;
  const options: Record<string, unknown> =
    typeof given === "object" && given !== null ? { ...given } : {};
  const top: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(parts.rest)) {
    if (OLLAMA_OPTION_FIELDS.includes(key)) {
      options[key] = value;
    } else if (key !== "options") {
      top[key] = value;
    }
  }

  if (parts.maxOutputTokens !== null) {
    options.num_predict = parts.maxOutputTokens;
  }

  return {
    ...top,
    messages: withSystemMessage(parts),
    ...(Object.keys(options).length === 0 ? {} : { options }),
    model: modelId,
    stream: true,
  };
}
