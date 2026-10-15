/**
 * Anthropic Messages SSE → {@link InvocationChunk}s — the first of AF.1's three parsers.
 *
 * ```
 * message_start        ─▶ usage   (input, cache read/write, output so far)
 * content_block_delta  ─▶ delta   (text_delta only)
 * message_delta        ─▶ usage   (output restated cumulatively), stop_reason kept
 * message_stop         ─▶ done
 * error                ─▶ throw, classified
 * ping, everything else ─▶ ignored
 * ```
 *
 * Only `text_delta` becomes a delta. Thinking and tool-input deltas are not text a worker reads
 * as the answer; the Messages-format facade (DH.2) relays those byte for byte instead.
 */

import type { InvocationChunk, InvocationUsage } from "../provider.adapter";
import {
  ProviderAdapterError,
  type ModelRefusal,
  type ProviderErrorClass,
} from "../provider.errors";
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

/**
 * Anthropic's error `type`s, as the adapter classes they mean.
 *
 * Anything not listed is `upstream`: an unknown failure in the middle of an answer is the
 * provider's, and advancing is what a chain is for.
 */
const ERROR_CLASSES: Readonly<Record<string, ProviderErrorClass>> = Object.freeze({
  invalid_request_error: "config",
  request_too_large: "config",
  not_found_error: "config",
  authentication_error: "auth",
  permission_error: "auth",
  rate_limit_error: "rate_limit",
  timeout_error: "network",
  api_error: "upstream",
  overloaded_error: "upstream",
});

/** What a request that is too long for the model reads like, in Anthropic's words. */
const CONTEXT_WINDOW = /prompt is too long|context window|too many (input )?tokens/i;

/**
 * Tell a G8 refusal apart from an ordinary Anthropic refusal.
 *
 * @param status - The HTTP status.
 * @param body - The parsed error body.
 * @returns The refusal, or null.
 */
export function anthropicRefusal(status: number, body: unknown): ModelRefusal | null {
  const text = errorText(body);

  if (status === 404 && /model/i.test(text)) {
    return "model_not_found";
  }

  return CONTEXT_WINDOW.test(text) ? "context_window_exceeded" : null;
}

/**
 * The usage a frame reports, merged over what was known.
 *
 * @param known - The usage so far.
 * @param reported - The frame's `usage` object.
 * @returns The new cumulative usage. A field the frame does not carry keeps its old value.
 */
function merged(known: InvocationUsage, reported: unknown): InvocationUsage {
  const pick = (key: string, previous: number): number =>
    field(reported, key) === undefined ? previous : count(field(reported, key));

  return {
    inputTokens: pick("input_tokens", known.inputTokens),
    outputTokens: pick("output_tokens", known.outputTokens),
    cacheReadTokens: pick("cache_read_input_tokens", known.cacheReadTokens),
    cacheWriteTokens: pick("cache_creation_input_tokens", known.cacheWriteTokens),
  };
}

/** What an Anthropic stream has said so far. */
interface AnthropicState {
  usage: InvocationUsage;
  stopReason: string | null;
}

/**
 * One event's chunks.
 *
 * @param event - The event.
 * @param state - The stream so far; updated in place.
 * @returns The chunks to yield; the last is `done` when the stream completed.
 * @throws {ProviderAdapterError} For an `error` event, classified by its type.
 */
function step(event: SseEvent, state: AnthropicState): InvocationChunk[] {
  const frame = frameJson(event.data);
  const type = field(frame, "type") ?? event.event;

  switch (type) {
    case "message_start":
      state.usage = merged(state.usage, field(field(frame, "message"), "usage"));
      return [{ kind: "usage", usage: state.usage }];
    case "content_block_delta": {
      const delta = field(frame, "delta");
      const text = field(delta, "text");

      return field(delta, "type") === "text_delta" && typeof text === "string" && text !== ""
        ? [{ kind: "delta", text }]
        : [];
    }
    case "message_delta": {
      const reason = field(field(frame, "delta"), "stop_reason");

      state.stopReason = typeof reason === "string" ? reason : state.stopReason;

      if (field(frame, "usage") === undefined) {
        return [];
      }

      state.usage = merged(state.usage, field(frame, "usage"));
      return [{ kind: "usage", usage: state.usage }];
    }
    case "message_stop":
      return [{ kind: "done", finishReason: state.stopReason ?? "end_turn" }];
    case "error": {
      const kind = field(field(frame, "error"), "type");
      const errorClass = (typeof kind === "string" ? ERROR_CLASSES[kind] : undefined) ?? "upstream";

      throw new ProviderAdapterError(errorClass, `stream error (${errorClass})`);
    }
    default:
      return [];
  }
}

/**
 * Parse an Anthropic Messages stream.
 *
 * @param source - The response body, or the call that opens it.
 * @yields Deltas, cumulative usage, and one `done` last.
 * @throws {ProviderAdapterError} For a refused request, an `error` event (classified by its
 *   type), a malformed frame, or a stream that ends before `message_stop`.
 */
export async function* parseAnthropicStream(source: ByteSource): AsyncGenerator<InvocationChunk> {
  const decoder = new SseDecoder();
  const state: AnthropicState = {
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: null,
  };

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

  throw endedEarly();
}
