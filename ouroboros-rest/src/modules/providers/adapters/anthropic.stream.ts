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

import type { InvocationChunk, InvocationUsage, RelayedMessages } from "../provider.adapter";
import { isRedirect } from "../provider.address";
import {
  ProviderAdapterError,
  classifyHttpStatus,
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

/**
 * Reads usage off a Messages stream the facade is relaying, without touching the bytes — DH.2
 * ([#1303](https://github.com/NobuData/ouroboros/issues/1303)).
 *
 * Fed every chunk as it is relayed. It never throws: a frame it cannot read is the provider's
 * business and the harness's to see, and a relay must not stop because its meter could not
 * parse something.
 */
export class AnthropicUsageTap {
  private readonly decoder = new SseDecoder();
  private readonly state: AnthropicState = {
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: null,
  };
  private seen = false;
  private done = false;

  /**
   * Feed a relayed chunk.
   *
   * @param chunk - The bytes, exactly as relayed.
   */
  push(chunk: Uint8Array): void {
    try {
      this.read(this.decoder.push(chunk));
    } catch {
      // Unreadable framing is relayed regardless; the meter keeps what it has.
    }
  }

  /** The stream ended. */
  end(): void {
    try {
      this.read(this.decoder.end());
    } catch {
      // As above.
    }
  }

  /** @returns The cumulative usage the provider reported, or null when it reported none. */
  usage(): InvocationUsage | null {
    return this.seen ? this.state.usage : null;
  }

  /** @returns Whether `message_stop` arrived. */
  completed(): boolean {
    return this.done;
  }

  /**
   * Fold events into the usage.
   *
   * @param events - Complete events.
   */
  private read(events: readonly SseEvent[]): void {
    for (const event of events) {
      let chunks: InvocationChunk[];

      try {
        chunks = step(event, this.state);
      } catch {
        continue;
      }

      for (const chunk of chunks) {
        this.seen ||= chunk.kind === "usage";
        this.done ||= chunk.kind === "done";
      }
    }
  }
}

/**
 * The usage a non-streamed Messages response reports.
 *
 * @param body - The parsed response body.
 * @returns The usage, or null when the body carries none.
 */
export function messageUsage(body: unknown): InvocationUsage | null {
  const usage = field(body, "usage");

  if (typeof usage !== "object" || usage === null) {
    return null;
  }

  return merged(
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    usage,
  );
}

/**
 * A provider response as the facade relays it: a refusal classified from its body, or a
 * success whose usage is read as it passes — DH.2 ([#1303](https://github.com/NobuData/ouroboros/issues/1303)).
 *
 * @param response - The Messages API's response.
 * @returns The relayed answer. The body's bytes are the provider's, unmodified.
 */
export async function relayed(response: Response): Promise<RelayedMessages> {
  const contentType = response.headers.get("content-type") ?? "application/json";
  const requestId = response.headers.get("request-id");

  if (!response.ok) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    let parsed: unknown = null;

    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      parsed = null;
    }

    const errorClass = isRedirect(response.status) ? "config" : classifyHttpStatus(response.status);

    return {
      status: response.status,
      contentType,
      requestId,
      failure: {
        errorClass,
        refusal: errorClass === "config" ? anthropicRefusal(response.status, parsed) : null,
      },
      body: once(bytes),
      usage: () => null,
    };
  }

  const streamed = contentType.includes("text/event-stream");
  const tap = new AnthropicUsageTap();
  const collected: Uint8Array[] = [];
  let usage: InvocationUsage | null = null;
  const source = (response.body ?? once(new Uint8Array())) as AsyncIterable<Uint8Array>;

  async function* passing(): AsyncGenerator<Uint8Array> {
    for await (const chunk of source) {
      if (streamed) {
        tap.push(chunk);
      } else {
        collected.push(chunk);
      }

      yield chunk;
    }

    if (streamed) {
      tap.end();
      usage = tap.usage();
    } else {
      try {
        usage = messageUsage(JSON.parse(Buffer.concat(collected).toString("utf8")) as unknown);
      } catch {
        usage = null;
      }
    }
  }

  return {
    status: response.status,
    contentType,
    requestId,
    failure: null,
    body: passing(),
    usage: () => (streamed && usage === null ? tap.usage() : usage),
  };
}

/**
 * A body of one chunk.
 *
 * @param bytes - The bytes.
 * @yields Them, once.
 */
async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  await Promise.resolve();
  yield bytes;
}
