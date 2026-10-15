/**
 * OpenAI chat-completions SSE → {@link InvocationChunk}s — the second of AF.1's three parsers.
 *
 * Serves the `openai_compatible` adapter, and with it vLLM, LM Studio and every other server
 * that speaks this format.
 *
 * ```
 * data: {choices:[{delta:{content}}]}         ─▶ delta
 * data: {choices:[{finish_reason}]}           ─▶ kept for done
 * data: {usage:{prompt_tokens,…}}             ─▶ usage   (sent because the adapter asks:
 *                                                         stream_options.include_usage)
 * data: {error:{…}}                           ─▶ throw
 * data: [DONE]                                ─▶ done
 * ```
 *
 * A stream that ends without `[DONE]` but after a `finish_reason` is complete — some servers
 * omit the sentinel. One that ends before either ended early.
 */

import type { InvocationChunk } from "../provider.adapter";
import { ProviderAdapterError, type ModelRefusal } from "../provider.errors";
import {
  SseDecoder,
  bytesOf,
  count,
  endedEarly,
  errorText,
  field,
  frameJson,
  type ByteSource,
  type SseEvent,
} from "./invocation.stream";

/** The sentinel that ends an OpenAI stream. */
const DONE_SENTINEL = "[DONE]";

/** A request too long for the model, in OpenAI's and vLLM's words. */
const CONTEXT_WINDOW =
  /context_length_exceeded|maximum context length|context window|too many tokens/i;

/** A model the server does not have, in OpenAI's and vLLM's words. */
const MODEL_NOT_FOUND = /model_not_found|model .*(does not exist|not found)/i;

/**
 * Tell a G8 refusal apart from an ordinary OpenAI-format refusal.
 *
 * @param status - The HTTP status.
 * @param body - The parsed error body.
 * @returns The refusal, or null.
 */
export function openAiRefusal(status: number, body: unknown): ModelRefusal | null {
  const text = errorText(body);

  if (MODEL_NOT_FOUND.test(text) || (status === 404 && /model/i.test(text))) {
    return "model_not_found";
  }

  return CONTEXT_WINDOW.test(text) ? "context_window_exceeded" : null;
}

/**
 * One event's chunks.
 *
 * @param event - The event.
 * @param state - The finish reason seen so far; updated in place.
 * @returns The chunks to yield; the last is `done` on `[DONE]`.
 * @throws {ProviderAdapterError} For an error frame — `rate_limit` when it says so.
 */
function step(event: SseEvent, state: { finishReason: string | null }): InvocationChunk[] {
  if (event.data.trim() === DONE_SENTINEL) {
    return [{ kind: "done", finishReason: state.finishReason ?? "stop" }];
  }

  const frame = frameJson(event.data);
  const error = field(frame, "error");

  if (error !== undefined && error !== null) {
    const limited = /rate.?limit/i.test(errorText(frame));

    throw new ProviderAdapterError(limited ? "rate_limit" : "upstream", "stream error");
  }

  const out: InvocationChunk[] = [];
  const choices = field(frame, "choices");
  const choice: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const content = field(field(choice, "delta"), "content");
  const reason = field(choice, "finish_reason");

  if (typeof content === "string" && content !== "") {
    out.push({ kind: "delta", text: content });
  }

  state.finishReason = typeof reason === "string" ? reason : state.finishReason;

  const usage = field(frame, "usage");

  if (typeof usage === "object" && usage !== null) {
    const cached = count(field(field(usage, "prompt_tokens_details"), "cached_tokens"));

    out.push({
      kind: "usage",
      usage: {
        inputTokens: Math.max(0, count(field(usage, "prompt_tokens")) - cached),
        outputTokens: count(field(usage, "completion_tokens")),
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
      },
    });
  }

  return out;
}

/**
 * Parse an OpenAI chat-completions stream.
 *
 * @param source - The response body, or the call that opens it.
 * @yields Deltas, the usage total, and one `done` last.
 * @throws {ProviderAdapterError} For a refused request, an error frame, a malformed frame, or a
 *   stream that ends before it finished.
 */
export async function* parseOpenAiStream(source: ByteSource): AsyncGenerator<InvocationChunk> {
  const decoder = new SseDecoder();
  const state = { finishReason: null as string | null };

  for await (const bytes of await bytesOf(source)) {
    for (const event of decoder.push(bytes)) {
      for (const chunk of step(event, state)) {
        yield chunk;

        if (chunk.kind === "done") {
          return;
        }
      }
    }
  }

  for (const event of decoder.end()) {
    for (const chunk of step(event, state)) {
      yield chunk;

      if (chunk.kind === "done") {
        return;
      }
    }
  }

  if (state.finishReason !== null) {
    yield { kind: "done", finishReason: state.finishReason };
    return;
  }

  throw endedEarly();
}
