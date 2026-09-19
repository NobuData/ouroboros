/**
 * The runner protocol's codec — the gateway's reading of every frame an agent writes, and the
 * writing of every frame it answers with.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)), against
 * [`docs/RUNNER_PROTOCOL.md`](../../../../../docs/RUNNER_PROTOCOL.md) and
 * `schemas/runner-protocol/v1.json`. The Go agent's `internal/conn/protocol.go` is the other
 * half, and the two are held together by one file rather than by either reading the other:
 * `schemas/runner-protocol/fixtures/expected.json`, whose every case `protocol.spec.ts` decodes
 * and compares element by element — same codes, same paths, same order.
 *
 * ```
 * bytes ─▶ size ≤ 65536? ─▶ JSON object? ─▶ envelope: v · type · id · payload, nothing else
 *                                               │   (an envelope error ENDS the walk)
 *                                               ▼
 *                                         payload vs its table (protocol.schema.ts)
 *                                               ▼
 *                                    diagnostics sorted by path, then code
 * ```
 *
 * ---------------------------------------------------------------------------
 * **A diagnostic is a code and a path; never a sentence.** The contract is over the pair — § 6
 * of the protocol document — and each implementation renders its own prose. That is also why a
 * refused frame's diagnostics are safe to log: they name *where* a frame was wrong, not what
 * was in it.
 *
 * **Direction is not the codec's to check** — a codec does not know which end it runs on — so
 * {@link SENT_BY} is published here and `gateway/` applies it: a `job.offer` arriving *from* an
 * agent is a legal frame and a protocol violation.
 */

import { WireNumber, SPECS, checkObject, escape, type Diagnostic } from "./protocol.schema";
import type { Payloads } from "./protocol.messages";
import { newUlid } from "./ulid";

export { LOG_CHUNK_MAX_BASE64_CHARS, LOG_CHUNK_MAX_BYTES } from "./protocol.schema";
export type { Diagnostic, DiagnosticCode } from "./protocol.schema";

/** The newest protocol line this implementation speaks — the `v` it writes. */
export const PROTOCOL_VERSION = 1;

/** The oldest line this implementation still speaks. */
export const PROTOCOL_MIN_VERSION = 1;

/** A frame larger than this is not a frame, and is rejected without being parsed. */
export const ENVELOPE_MAX_BYTES = 65536;

/** Every message type, in `v1.json`'s order. */
export const MESSAGE_TYPES = [
  "hello",
  "ack",
  "refuse",
  "heartbeat",
  "job.offer",
  "job.accept",
  "job.decline",
  "job.start",
  "job.progress",
  "job.finish",
  "log.chunk",
  "receipt",
  "drain",
  "undrain",
  "bye",
] as const;

/** One message type. */
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** Which end wrote a frame, spelt as `sessions/*.json` spells it. */
export type Sender = "agent" | "server";

/**
 * Who may send each type — fixed per type, so a frame in the wrong direction is a violation
 * and neither end has to guess whether it was meant.
 */
export const SENT_BY: Readonly<Record<MessageType, readonly Sender[]>> = {
  hello: ["agent"],
  ack: ["server"],
  refuse: ["server"],
  heartbeat: ["agent"],
  "job.offer": ["server"],
  "job.accept": ["agent"],
  "job.decline": ["agent"],
  "job.start": ["agent"],
  "job.progress": ["agent"],
  "job.finish": ["agent"],
  "log.chunk": ["agent"],
  receipt: ["server"],
  drain: ["server"],
  undrain: ["server"],
  bye: ["agent", "server"],
};

/** The terminal types — acknowledged with a `receipt`, deduplicated by envelope id. */
export const TERMINAL_TYPES: readonly MessageType[] = ["job.finish"];

/** A frame that decoded: its envelope, with the payload as plain JSON values. */
export interface Envelope<T extends MessageType = MessageType> {
  readonly v: number;
  readonly type: T;
  readonly id: string;
  readonly payload: Payloads[T];
}

/** What {@link decode} answers: the envelope when there were no diagnostics. */
export type Decoded =
  | { readonly envelope: Envelope; readonly diagnostics: readonly [] }
  | { readonly envelope: undefined; readonly diagnostics: readonly Diagnostic[] };

/** A frame about to be written. */
export interface Frame<T extends MessageType = MessageType> {
  readonly v: number;
  readonly type: T;
  readonly id: string;
  readonly payload: Payloads[T];
}

/** The four envelope keys, and the only four. */
const ENVELOPE_KEYS = new Set(["v", "type", "id", "payload"]);

/** A bare ULID — `$defs/ulid`. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Decode and judge one frame.
 *
 * @param raw - The frame as it arrived: the bytes of one text message.
 * @returns The envelope and no diagnostics, or no envelope and at least one.
 */
export function decode(raw: Buffer | string): Decoded {
  const bytes = typeof raw === "string" ? Buffer.byteLength(raw) : raw.length;
  if (bytes > ENVELOPE_MAX_BYTES) return refused([{ code: "envelope.malformed", path: "" }]);

  const root = parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  if (root === undefined || !isObject(root)) {
    return refused([{ code: "envelope.malformed", path: "" }]);
  }

  const diagnostics: Diagnostic[] = [];

  for (const key of Object.keys(root)) {
    if (!ENVELOPE_KEYS.has(key)) {
      diagnostics.push({ code: "envelope.field.unknown", path: `/${escape(key)}` });
    }
  }

  const v = root.v;
  if (!Object.hasOwn(root, "v")) diagnostics.push({ code: "envelope.field.missing", path: "/v" });
  else if (!(v instanceof WireNumber) || !v.integer) {
    diagnostics.push({ code: "envelope.field.type", path: "/v" });
  } else if (v.value !== PROTOCOL_VERSION) {
    diagnostics.push({ code: "envelope.version.unsupported", path: "/v" });
  }

  const type = root.type;
  if (!Object.hasOwn(root, "type")) {
    diagnostics.push({ code: "envelope.field.missing", path: "/type" });
  } else if (typeof type !== "string") {
    diagnostics.push({ code: "envelope.field.type", path: "/type" });
  } else if (!isMessageType(type)) {
    diagnostics.push({ code: "envelope.type.unknown", path: "/type" });
  }

  const id = root.id;
  if (!Object.hasOwn(root, "id")) diagnostics.push({ code: "envelope.field.missing", path: "/id" });
  else if (typeof id !== "string") diagnostics.push({ code: "envelope.field.type", path: "/id" });
  else if (!ULID.test(id)) diagnostics.push({ code: "envelope.id.malformed", path: "/id" });

  const payload = root.payload;
  if (!Object.hasOwn(root, "payload")) {
    diagnostics.push({ code: "envelope.field.missing", path: "/payload" });
  } else if (!isObject(payload)) {
    diagnostics.push({ code: "envelope.field.type", path: "/payload" });
  }

  // An envelope error ends the walk: a frame whose envelope does not decode has no payload to
  // check, and reporting one would mean guessing which type it was meant to be.
  if (diagnostics.length > 0) return refused(diagnostics);

  const messageType = type as MessageType;
  const body = payload as Record<string, unknown>;
  const spec = SPECS[messageType];

  const values = plain(body) as Record<string, unknown>;

  diagnostics.push(...checkObject("/payload", spec.fields, body));
  if (spec.extra) diagnostics.push(...spec.extra(values));

  if (diagnostics.length > 0) return refused(diagnostics);

  return {
    envelope: {
      v: PROTOCOL_VERSION,
      type: messageType,
      id: id as string,
      payload: values as unknown as Payloads[MessageType],
    },
    diagnostics: [],
  };
}

/**
 * Compose a frame this end is about to write.
 *
 * @param type - Which message.
 * @param payload - Its payload.
 * @param id - Its envelope id. Minted fresh unless the caller is re-sending a frame whose id is
 *   its identity.
 * @returns The frame.
 */
export function frame<T extends MessageType>(
  type: T,
  payload: Payloads[T],
  id: string = newUlid(),
): Frame<T> {
  return { v: PROTOCOL_VERSION, type, id, payload };
}

/**
 * Encode a frame for the wire.
 *
 * @param value - The frame.
 * @returns One JSON object, as the text of one WebSocket message.
 * @throws {RangeError} If it would exceed {@link ENVELOPE_MAX_BYTES} — an oversized frame is a
 *   bug in the writer, and sending it would only move the refusal to the other end.
 */
export function encode(value: Frame): string {
  const text = JSON.stringify(value);

  if (Buffer.byteLength(text) > ENVELOPE_MAX_BYTES) {
    throw new RangeError(
      `${value.type} frame is ${String(Buffer.byteLength(text))} bytes, ` +
        `over the ${String(ENVELOPE_MAX_BYTES)}-byte ceiling`,
    );
  }

  return text;
}

/**
 * Whether a string names a message type.
 *
 * @param value - The string.
 * @returns Whether it is one of {@link MESSAGE_TYPES}.
 */
export function isMessageType(value: string): value is MessageType {
  return (MESSAGE_TYPES as readonly string[]).includes(value);
}

/**
 * Sort diagnostics into the contract's order: by path — numeric segments compared as numbers,
 * so `/payload/command/2` precedes `/payload/command/10` — then by code.
 *
 * @param diagnostics - The diagnostics.
 * @returns A sorted copy.
 */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => {
    if (a.path !== b.path) return comparePaths(a.path, b.path);
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
}

/**
 * Compare two RFC 6901 paths segment by segment.
 *
 * @param a - One path.
 * @param b - The other.
 * @returns Negative when `a` sorts first.
 */
function comparePaths(a: string, b: string): number {
  const as = a.split("/");
  const bs = b.split("/");

  for (let i = 0; i < as.length && i < bs.length; i += 1) {
    if (as[i] === bs[i]) continue;

    const an = /^[+-]?\d+$/.test(as[i]) ? Number(as[i]) : undefined;
    const bn = /^[+-]?\d+$/.test(bs[i]) ? Number(bs[i]) : undefined;
    if (an !== undefined && bn !== undefined) return an - bn;

    return as[i] < bs[i] ? -1 : 1;
  }

  return as.length - bs.length;
}

/**
 * A refusal, sorted.
 *
 * @param diagnostics - What was wrong.
 * @returns The decode result.
 */
function refused(diagnostics: readonly Diagnostic[]): Decoded {
  return { envelope: undefined, diagnostics: sortDiagnostics(diagnostics) };
}

/**
 * Parse JSON, keeping each number's source text.
 *
 * Node 24's `JSON.parse` hands a reviver the literal it parsed as `context.source`, which is
 * what lets `1` and `1.0` be told apart — see `protocol.schema.ts` on why they must be.
 *
 * @param text - The frame's text.
 * @returns The value with every number a {@link WireNumber}, or `undefined` when it is not JSON.
 */
function parse(text: string): unknown {
  try {
    return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
      if (typeof value !== "number") return value;

      const source = context?.source;
      return new WireNumber(
        value,
        source === undefined ? Number.isInteger(value) : /^-?\d+$/.test(source),
      );
    }) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Turn a parsed value back into plain JSON values.
 *
 * @param value - A value from {@link parse}.
 * @returns The same value with every {@link WireNumber} replaced by its number.
 */
function plain(value: unknown): unknown {
  if (value instanceof WireNumber) return value.value;
  if (Array.isArray(value)) return value.map(plain);
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  }

  return value;
}

/**
 * Whether a parsed value is a JSON object — not an array, not null, not a number.
 *
 * @param value - The value.
 * @returns Whether it is an object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof WireNumber)
  );
}
