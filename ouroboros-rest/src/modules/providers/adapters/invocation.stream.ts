/**
 * What the three invocation stream parsers share — AF.2
 * ([#235](https://github.com/NobuData/ouroboros/issues/235)).
 *
 * ```
 * openInvocation ─▶ POST, refusal classified ─▶ Response body
 *   LineDecoder.push(chunk) ─▶ the lines it completed, split frames rejoined   (Ollama NDJSON)
 *   SseDecoder.push(chunk)  ─▶ the SSE events it completed                     (Anthropic, OpenAI)
 * ```
 *
 * AF.1's decision 4-A costs *one parser per wire format*, not one per provider, and these are
 * the parts the formats have in common: a byte stream cut at arbitrary points (a frame split
 * across two chunks is the normal case, not an edge case), a line-length ceiling so a
 * misbehaving endpoint costs a classified error rather than the process, and a refused
 * request turned into the five adapter classes plus the two G8 refusals.
 *
 * It lives in `adapters/` because it opens a socket, and the provider boundary keeps every
 * provider-facing request there.
 */

import {
  ProviderAdapterError,
  describeTransportFailure,
  classifyHttpStatus,
  type ModelRefusal,
} from "../provider.errors";
import {
  PROVIDER_REDIRECT,
  describeRefusal,
  discardBody,
  isRedirect,
  readCappedBody,
} from "../provider.address";

/**
 * The longest single line or SSE event a stream may send, in bytes.
 *
 * One mebibyte — a delta is a few bytes and a usage frame a few hundred, so this is headroom
 * for a provider that sends a whole tool-call argument in one frame, not a budget.
 */
export const MAX_FRAME_BYTES = 1_048_576;

/** The most of a refusal body read to tell a G8 refusal apart, in bytes. */
export const REFUSAL_BODY_BYTES = 16_384;

/**
 * How long a provider may take to *start* answering, in milliseconds.
 *
 * Covers connecting and the response headers only; a stream that has started is bounded by
 * the executor's own deadline, because a long answer is not a slow one.
 */
export const INVOCATION_CONNECT_TIMEOUT_MS = 60_000;

/** One server-sent event: its `event:` name, when it had one, and its joined `data:` lines. */
export interface SseEvent {
  readonly event: string | null;
  readonly data: string;
}

/**
 * Tells, from a refused request's status and parsed body, whether it is a G8 refusal.
 *
 * @param status - The HTTP status.
 * @param body - The body parsed as JSON, or null when it was not JSON.
 * @returns The refusal, or null for an ordinary refusal of that status's class.
 */
export type RefusalDetector = (status: number, body: unknown) => ModelRefusal | null;

/** What {@link openInvocation} sends. */
export interface InvocationRequestInit {
  /** The absolute URL. */
  readonly url: string;
  /** The address's `host:port`, for the unreachable phrase. */
  readonly host: string;
  /** The request headers, credential included; built per call and never retained. */
  readonly headers: Readonly<Record<string, string>>;
  /** The JSON body. */
  readonly body: Readonly<Record<string, unknown>>;
  /** The call's signal. */
  readonly signal: AbortSignal;
}

/**
 * The stream ended without the frame that says it is complete.
 *
 * `upstream`, because the provider stopped answering partway through its own answer — the
 * same fact a `5xx` reports, which is why the executor advances past it.
 *
 * @returns The error to throw.
 */
export function endedEarly(): ProviderAdapterError {
  return new ProviderAdapterError("upstream", "stream ended early");
}

/**
 * A frame that was not what its format says it must be.
 *
 * @returns The error to throw. `upstream` for the reason {@link endedEarly} gives.
 */
export function malformedFrame(): ProviderAdapterError {
  return new ProviderAdapterError("upstream", "malformed stream frame");
}

/**
 * Parse one frame's JSON, or say it was malformed.
 *
 * @param text - The frame's text.
 * @returns The parsed value.
 * @throws {ProviderAdapterError} `upstream`, for text that is not JSON.
 */
export function frameJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw malformedFrame();
  }
}

/**
 * Read a property of something that may not be an object.
 *
 * @param value - Anything.
 * @param key - The property.
 * @returns The property's value, or undefined.
 */
export function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * A non-negative whole number, or zero.
 *
 * Token counts a provider did not send are zero rather than null, because a usage row's
 * columns are counts and an absent count is none counted.
 *
 * @param value - Anything.
 * @returns The count.
 */
export function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * The text of a provider's error message, for G8 matching only.
 *
 * Read and matched inside the adapter and never carried out of it — `error.envelope.ts`'s
 * rule that a provider's own words never reach a person still holds.
 *
 * @param body - A parsed error body.
 * @returns Every string the common error shapes put a message or code in, joined.
 */
export function errorText(body: unknown): string {
  const nested = field(body, "error");
  const parts = [
    field(body, "error"),
    field(body, "message"),
    field(nested, "message"),
    field(nested, "code"),
    field(nested, "type"),
  ];

  return parts.filter((part): part is string => typeof part === "string").join(" ");
}

/**
 * Where a parser reads its bytes from: a body, or the call that will open one.
 *
 * The call form is what lets an adapter's `invoke` return its parser directly — the request is
 * sent on the first read, so a refusal surfaces from the iterator, where a `for await` catches
 * it, and an iterator nobody reads sends nothing.
 */
export type ByteSource = AsyncIterable<Uint8Array> | (() => Promise<AsyncIterable<Uint8Array>>);

/**
 * The bytes a source names.
 *
 * @param source - A body, or the call that opens one.
 * @returns The body.
 */
export async function bytesOf(source: ByteSource): Promise<AsyncIterable<Uint8Array>> {
  return typeof source === "function" ? source() : source;
}

/**
 * Splits a byte stream into lines, rejoining the ones cut across chunks.
 *
 * Synchronous on purpose: each parser reads its body with one `for await` and feeds every
 * chunk through this, so a token costs no promise between the socket and the parser.
 */
export class LineDecoder {
  private readonly decoder = new TextDecoder();
  private buffer = "";

  /**
   * Feed a chunk.
   *
   * @param chunk - The next bytes.
   * @returns The lines it completed, without `\n` or a trailing `\r`.
   * @throws {ProviderAdapterError} `upstream`, for a line longer than {@link MAX_FRAME_BYTES}.
   */
  push(chunk: Uint8Array): string[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });

    const out: string[] = [];
    let newline = this.buffer.indexOf("\n");

    while (newline !== -1) {
      out.push(trimCarriageReturn(this.buffer.slice(0, newline)));
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
    }

    if (this.buffer.length > MAX_FRAME_BYTES) {
      throw new ProviderAdapterError("upstream", "stream frame too large");
    }

    return out;
  }

  /**
   * The stream ended.
   *
   * @returns A last line that had no newline, when there was one: a stream's final frame is
   *   not always terminated.
   */
  end(): string[] {
    this.buffer += this.decoder.decode();

    const rest = this.buffer;

    this.buffer = "";

    return rest.length > 0 ? [trimCarriageReturn(rest)] : [];
  }
}

/**
 * Drop the `\r` of a CRLF line ending.
 *
 * @param line - A line.
 * @returns It, without a trailing carriage return.
 */
function trimCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/**
 * Groups a byte stream into server-sent events.
 *
 * The parts of the SSE grammar providers use: `event:` and `data:` fields, multi-line data
 * joined by `\n`, comments (`:`) ignored, and a blank line dispatching. An event with no data
 * line is not dispatched, as the specification says.
 */
export class SseDecoder {
  private readonly lines = new LineDecoder();
  private event: string | null = null;
  private data: string[] = [];

  /**
   * Feed a chunk.
   *
   * @param chunk - The next bytes.
   * @returns The events it completed.
   */
  push(chunk: Uint8Array): SseEvent[] {
    return this.read(this.lines.push(chunk));
  }

  /**
   * The stream ended.
   *
   * @returns A final event with no blank line after it, when there was one.
   */
  end(): SseEvent[] {
    const out = this.read(this.lines.end());

    if (this.data.length > 0) {
      out.push({ event: this.event, data: this.data.join("\n") });
      this.data = [];
    }

    return out;
  }

  /**
   * Fold lines into events.
   *
   * @param lines - Complete lines.
   * @returns The events they dispatched.
   */
  private read(lines: readonly string[]): SseEvent[] {
    const out: SseEvent[] = [];

    for (const line of lines) {
      if (line === "") {
        if (this.data.length > 0) {
          out.push({ event: this.event, data: this.data.join("\n") });
        }

        this.event = null;
        this.data = [];
        continue;
      }

      if (line.startsWith(":")) {
        continue;
      }

      const colon = line.indexOf(":");
      const name = colon === -1 ? line : line.slice(0, colon);
      const raw = colon === -1 ? "" : line.slice(colon + 1);
      const value = raw.startsWith(" ") ? raw.slice(1) : raw;

      if (name === "event") {
        this.event = value;
      } else if (name === "data") {
        this.data.push(value);
      }
    }

    return out;
  }
}

/**
 * Send one invocation and hand back the body that streams its answer.
 *
 * Redirects are not followed (`PROVIDER_REDIRECT`), for the reason every adapter request
 * gives. A refusal's body is read — capped at {@link REFUSAL_BODY_BYTES} — only so `detect`
 * can tell a G8 refusal apart; its text never leaves this function.
 *
 * @param init - The request.
 * @param detect - The format's G8 detector.
 * @returns The streaming body.
 * @throws {ProviderAdapterError} `network` when nothing answered in time, the status's class
 *   for a refusal (with `refusal` set for a G8 one), `upstream` for a 2xx with no body.
 */
export async function openInvocation(
  init: InvocationRequestInit,
  detect: RefusalDetector,
): Promise<AsyncIterable<Uint8Array>> {
  const connect = AbortSignal.timeout(INVOCATION_CONNECT_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(init.url, {
      method: "POST",
      headers: { ...init.headers, "content-type": "application/json" },
      body: JSON.stringify(init.body),
      redirect: PROVIDER_REDIRECT,
      signal: AbortSignal.any([init.signal, connect]),
    });
  } catch (error) {
    throw new ProviderAdapterError(
      "network",
      `${init.host} ${describeTransportFailure(error, INVOCATION_CONNECT_TIMEOUT_MS)}`,
    );
  }

  if (!response.ok) {
    throw await refusalOf(response, detect);
  }

  if (response.body === null) {
    throw endedEarly();
  }

  return response.body as AsyncIterable<Uint8Array>;
}

/**
 * Classify a refused invocation.
 *
 * @param response - A non-2xx response.
 * @param detect - The format's G8 detector.
 * @returns The error.
 */
async function refusalOf(
  response: Response,
  detect: RefusalDetector,
): Promise<ProviderAdapterError> {
  const status = response.status;

  if (isRedirect(status)) {
    await discardBody(response);

    return new ProviderAdapterError("config", describeRefusal(status), status);
  }

  const errorClass = classifyHttpStatus(status);
  let refusal: ModelRefusal | null = null;

  if (errorClass === "config") {
    const body = await readCappedBody(response, REFUSAL_BODY_BYTES);
    let parsed: unknown = null;

    if (body.read) {
      try {
        parsed = JSON.parse(body.text) as unknown;
      } catch {
        parsed = body.text;
      }
    }

    refusal = detect(status, parsed);
  } else {
    await discardBody(response);
  }

  return new ProviderAdapterError(errorClass, describeRefusal(status), status, refusal);
}
