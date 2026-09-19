/**
 * `schemas/runner-protocol/v1.json`, read as declarative tables — the TypeScript half of what
 * `ouroboros-runner/internal/conn/schema.go` is for Go.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)). The tables are a port of the
 * Go agent's, field for field and in the same order, and **that is deliberate rather than
 * lazy**: two implementations that each read the schema their own way would agree on every
 * fixture and disagree on the first frame nobody wrote one for. Two implementations that are
 * visibly the same table can be read against each other — and against `v1.json`'s `$defs` — in
 * one pass.
 *
 * What keeps them honest is not this comment but
 * `schemas/runner-protocol/fixtures/expected.json`, which this module's `protocol.spec.ts` and
 * the Go package's `protocol_test.go` both assert against, element by element. A rule added to
 * one table and forgotten in the other fails in the half that forgot it.
 *
 * ---------------------------------------------------------------------------
 * **Numbers arrive as {@link WireNumber}s, not as numbers.** `JSON.parse` turns `1`, `1.0` and
 * `1e0` into the same value, and the protocol does not: `v` and every counter are *integers*,
 * and the Go decoder (in `UseNumber` mode) refuses `1.0` for one. `protocol.ts` parses with a
 * reviver that keeps each number's source text, so the integrality check here reads what was
 * written rather than what it evaluates to.
 */

/** Every rejection this contract can produce — `$defs/diagnostic_codes` in `v1.json`. */
export type DiagnosticCode =
  | "envelope.malformed"
  | "envelope.field.missing"
  | "envelope.field.type"
  | "envelope.field.unknown"
  | "envelope.version.unsupported"
  | "envelope.type.unknown"
  | "envelope.id.malformed"
  | "payload.field.missing"
  | "payload.field.type"
  | "payload.field.unknown"
  | "payload.field.enum"
  | "payload.field.range"
  | "payload.field.conflict";

/** One rejection: what, and the RFC 6901 path it is anchored at. */
export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly path: string;
}

/** A number as it was written on the wire — its value, and whether it was written as an integer. */
export class WireNumber {
  /**
   * @param value - The number.
   * @param integer - Whether its source text was an integer literal: no `.`, no exponent.
   */
  constructor(
    readonly value: number,
    readonly integer: boolean,
  ) {}
}

/** The JSON types this validator distinguishes, as bits — so `object | null` is one field. */
export const Kind = {
  String: 1,
  Integer: 2,
  Number: 4,
  Bool: 8,
  Object: 16,
  Array: 32,
  Null: 64,
} as const;

/** One entry in a payload contract: its name, what it may be, and every bound on it. */
export interface Field {
  /** The key it appears under. Empty for an array element or an open map's value. */
  readonly name: string;
  /** A union of {@link Kind} bits. */
  readonly kinds: number;
  /** Whether the key may be absent. Everything is required unless it says otherwise. */
  readonly optional?: boolean;
  /** A closed set of string values. */
  readonly enum?: readonly string[];
  /** A published shape for a string — a job id, a timestamp. */
  readonly pattern?: RegExp;
  /** Numeric bounds, inclusive. */
  readonly min?: number;
  readonly max?: number;
  /** String length bounds, in code points. */
  readonly minLen?: number;
  readonly maxLen?: number;
  /** Array item-count bounds. */
  readonly minItems?: number;
  readonly maxItems?: number;
  /** An open map's key-count bound. */
  readonly maxProps?: number;
  /** A closed object's own contract. */
  readonly fields?: readonly Field[];
  /** An array's element contract. */
  readonly item?: Field;
  /** An OPEN map's value contract. Its presence suppresses the unknown-key check. */
  readonly value?: Field;
}

/** One message type's payload contract, and the cross-field rule a table cannot carry. */
export interface MessageSpec {
  readonly fields: readonly Field[];
  readonly extra?: (payload: Readonly<Record<string, unknown>>) => Diagnostic[];
}

/** The protocol's published shapes — `$defs` in `v1.json`. */
export const PATTERNS = {
  ulid: /^[0-9A-HJKMNP-TV-Z]{26}$/,
  session: /^sess_[0-9A-HJKMNP-TV-Z]{26}$/,
  runner: /^rnr_[0-9A-HJKMNP-TV-Z]{26}$/,
  job: /^job_[0-9A-HJKMNP-TV-Z]{26}$/,
  commit: /^[0-9a-f]{40}$/,
  timestamp: /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/,
} as const;

/** The ceiling on a `log.chunk`'s decoded bytes — `$defs/limits` in `v1.json`. */
export const LOG_CHUNK_MAX_BYTES = 32768;

/** The same ceiling on the wire form: 32768 bytes of base64 is 43692 characters. */
export const LOG_CHUNK_MAX_BASE64_CHARS = 43692;

const ARCH = ["linux/arm64", "linux/x86_64", "darwin/arm64"];
const EXECUTOR = ["container", "shell"];
const PHASE = ["fetch", "prepare", "run", "upload"];
const STATE = ["idle", "busy", "draining"];
const OUTCOME = ["succeeded", "failed", "cancelled", "timed_out", "errored"];
const STREAM = ["stdout", "stderr", "runner"];
const REFUSE = [
  "version.below_minimum",
  "version.unsupported",
  "identity.unknown",
  "identity.revoked",
  "pool.unknown",
  "capacity.exhausted",
];
const DECLINE = [
  "draining",
  "busy",
  "unsupported_executor",
  "image_unavailable",
  "capacity",
  "expired",
];
const CANCEL = ["operator", "reassigned"];
const DRAIN = ["operator", "upgrade", "decommission", "capacity"];
const BYE = ["shutdown", "drained", "error", "server_shutdown"];
const SECURITY_MODE = ["mtls", "bearer_fallback"];

/**
 * A job id field.
 *
 * @param name - Its key.
 * @returns The field.
 */
function jobId(name: string): Field {
  return { name, kinds: Kind.String, pattern: PATTERNS.job };
}

/**
 * A bare-ULID field — an offer's envelope id, a receipt's `of`.
 *
 * @param name - Its key.
 * @returns The field.
 */
function ulid(name: string): Field {
  return { name, kinds: Kind.String, pattern: PATTERNS.ulid };
}

/**
 * An RFC 3339 millisecond timestamp.
 *
 * @param name - Its key.
 * @returns The field.
 */
function timestamp(name: string): Field {
  return { name, kinds: Kind.String, pattern: PATTERNS.timestamp };
}

/**
 * The one-sentence explanation several messages carry for an operator.
 *
 * @param maxLen - Its ceiling; it ends up in a log line.
 * @returns The field, always named `detail` and always required.
 */
function detail(maxLen: number): Field {
  return { name: "detail", kinds: Kind.String, minLen: 1, maxLen };
}

/**
 * A whole percentage.
 *
 * @param name - Its key.
 * @returns The field.
 */
function percentage(name: string): Field {
  return { name, kinds: Kind.Integer, min: 0, max: 100 };
}

/**
 * A non-negative integer.
 *
 * @param name - Its key.
 * @returns The field.
 */
function count(name: string): Field {
  return { name, kinds: Kind.Integer, min: 0 };
}

/**
 * `job.offer`'s cross-field rule: the executor decides whether an image is required or
 * forbidden — forbidden rather than ignored, for `RUNNER_PROTOCOL.md`'s reason.
 *
 * @param payload - The payload.
 * @returns The diagnostics.
 */
function offerExtra(payload: Readonly<Record<string, unknown>>): Diagnostic[] {
  const executor = payload.executor;
  const hasImage = Object.hasOwn(payload, "image");

  if (executor === "container" && !hasImage) {
    return [{ code: "payload.field.missing", path: "/payload/image" }];
  }
  if (executor === "shell" && hasImage) {
    return [{ code: "payload.field.conflict", path: "/payload/image" }];
  }

  return [];
}

/**
 * `job.finish`'s cross-field rule: an outcome that ran has an exit code. A `null` under
 * `succeeded` or `failed` is a contradiction rather than a missing field.
 *
 * @param payload - The payload.
 * @returns The diagnostics.
 */
function finishExtra(payload: Readonly<Record<string, unknown>>): Diagnostic[] {
  const outcome = payload.outcome;
  if (outcome !== "succeeded" && outcome !== "failed") return [];

  if (Object.hasOwn(payload, "exit_code") && payload.exit_code === null) {
    return [{ code: "payload.field.conflict", path: "/payload/exit_code" }];
  }

  return [];
}

/**
 * `log.chunk`'s cross-field rule: the cap is on DECODED bytes, which only decoding answers —
 * 43692 base64 characters can carry 32769 bytes, one over. A string that is not base64 at all
 * is a type error, not a range one.
 *
 * @param payload - The payload.
 * @returns The diagnostics.
 */
function logChunkExtra(payload: Readonly<Record<string, unknown>>): Diagnostic[] {
  const data = payload.data;
  if (typeof data !== "string") return [];

  const size = decodedLength(data);
  if (size === undefined) return [{ code: "payload.field.type", path: "/payload/data" }];
  if (size > LOG_CHUNK_MAX_BYTES) return [{ code: "payload.field.range", path: "/payload/data" }];

  return [];
}

/**
 * How many bytes a standard, padded base64 string decodes to.
 *
 * Strict where `Buffer.from(…, "base64")` is lenient — Node skips characters it does not
 * recognise, and a validator built on that would call `not base64!!` a four-byte chunk. Go's
 * `base64.StdEncoding` ignores carriage returns and line feeds and nothing else, so this does
 * the same.
 *
 * @param text - The chunk's `data`.
 * @returns The decoded length, or `undefined` when it is not base64.
 */
export function decodedLength(text: string): number | undefined {
  const stripped = text.replace(/[\r\n]/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(stripped)) {
    return undefined;
  }

  const padding = stripped.endsWith("==") ? 2 : stripped.endsWith("=") ? 1 : 0;

  return (stripped.length / 4) * 3 - padding;
}

/** Every message type's contract. Keys are the enum in `v1.json`, in its order. */
export const SPECS: Readonly<Record<string, MessageSpec>> = {
  hello: {
    fields: [
      {
        name: "agent",
        kinds: Kind.Object,
        fields: [
          { name: "version", kinds: Kind.String, minLen: 1, maxLen: 64 },
          { name: "protocol_min", kinds: Kind.Integer, min: 1 },
          { name: "protocol_max", kinds: Kind.Integer, min: 1 },
        ],
      },
      { name: "arch", kinds: Kind.String, enum: ARCH },
      { name: "hostname", kinds: Kind.String, minLen: 1, maxLen: 253 },
      { name: "pool", kinds: Kind.String, minLen: 1, maxLen: 64, optional: true },
      {
        name: "capabilities",
        kinds: Kind.Object,
        fields: [
          { name: "docker", kinds: Kind.Bool },
          { name: "shell", kinds: Kind.Bool },
          { name: "ccache", kinds: Kind.Bool },
          { name: "cpus", kinds: Kind.Integer, min: 1 },
          { name: "memory_mb", kinds: Kind.Integer, min: 1 },
        ],
      },
      // Optional only because it was added inside line 1 (§ 3). The gateway reads the transport
      // for a hello that omits it.
      { name: "security_mode", kinds: Kind.String, enum: SECURITY_MODE, optional: true },
      { name: "resume", kinds: Kind.String, pattern: PATTERNS.session, optional: true },
    ],
  },

  ack: {
    fields: [
      { name: "session", kinds: Kind.String, pattern: PATTERNS.session },
      { name: "protocol", kinds: Kind.Integer, min: 1 },
      { name: "resumed", kinds: Kind.Bool },
      {
        name: "runner",
        kinds: Kind.Object,
        fields: [
          { name: "id", kinds: Kind.String, pattern: PATTERNS.runner },
          { name: "name", kinds: Kind.String, minLen: 1, maxLen: 253 },
          { name: "pool", kinds: Kind.String, minLen: 1, maxLen: 64 },
        ],
      },
      {
        name: "limits",
        kinds: Kind.Object,
        fields: [
          { name: "heartbeat_interval_ms", kinds: Kind.Integer, min: 1000, max: 300000 },
          { name: "heartbeat_jitter_ms", kinds: Kind.Integer, min: 0, max: 60000 },
          { name: "log_chunk_max_bytes", kinds: Kind.Integer, min: 1024, max: LOG_CHUNK_MAX_BYTES },
          { name: "log_rate_bytes_per_s", kinds: Kind.Integer, min: 1024 },
          { name: "offer_ack_ms", kinds: Kind.Integer, min: 100 },
          { name: "resume_window_ms", kinds: Kind.Integer, min: 1000 },
        ],
      },
      // Optional only because it was added inside line 1 (§ 3, #246). The bounds are the ones
      // runner_pools holds the same two columns to (#249).
      {
        name: "pool",
        kinds: Kind.Object,
        optional: true,
        fields: [
          { name: "max_concurrency", kinds: Kind.Integer, min: 1, max: 64 },
          {
            name: "env_allowlist",
            kinds: Kind.Array,
            maxItems: 64,
            item: { name: "", kinds: Kind.String, minLen: 1 },
          },
        ],
      },
    ],
  },

  refuse: {
    fields: [
      { name: "code", kinds: Kind.String, enum: REFUSE },
      { name: "minimum", kinds: Kind.Integer | Kind.Null, min: 1 },
      detail(512),
      { name: "retry_after_ms", kinds: Kind.Integer | Kind.Null, min: 0 },
    ],
  },

  heartbeat: {
    fields: [
      timestamp("sent_at"),
      { name: "state", kinds: Kind.String, enum: STATE },
      count("uptime_s"),
      // The three measurements are null when the agent's machine cannot take them (#245):
      // required, so the key is always there, and never a zero standing in for "unknown".
      { name: "cpu_pct", kinds: Kind.Number | Kind.Null, min: 0, max: 100 },
      { name: "memory_used_mb", kinds: Kind.Integer | Kind.Null, min: 0 },
      { name: "memory_total_mb", kinds: Kind.Integer | Kind.Null, min: 1 },
      count("queue_depth"),
      {
        name: "job",
        kinds: Kind.Object | Kind.Null,
        fields: [
          jobId("id"),
          { name: "phase", kinds: Kind.String, enum: PHASE },
          percentage("pct"),
        ],
      },
    ],
  },

  "job.offer": {
    fields: [
      jobId("job"),
      { name: "pool", kinds: Kind.String, minLen: 1, maxLen: 64 },
      { name: "executor", kinds: Kind.String, enum: EXECUTOR },
      // Optional in the table, and then required or forbidden by the executor — offerExtra.
      { name: "image", kinds: Kind.String, minLen: 1, maxLen: 512, optional: true },
      {
        name: "command",
        kinds: Kind.Array,
        minItems: 1,
        maxItems: 256,
        item: { name: "", kinds: Kind.String },
      },
      { name: "workdir", kinds: Kind.String, minLen: 1, maxLen: 1024 },
      {
        name: "env",
        kinds: Kind.Object,
        maxProps: 128,
        value: { name: "", kinds: Kind.String, maxLen: 4096 },
      },
      {
        name: "repository",
        kinds: Kind.Object | Kind.Null,
        fields: [
          { name: "url", kinds: Kind.String, minLen: 1, maxLen: 1024 },
          { name: "ref", kinds: Kind.String, minLen: 1, maxLen: 256 },
          { name: "commit", kinds: Kind.String, pattern: PATTERNS.commit },
        ],
      },
      { name: "timeout_s", kinds: Kind.Integer, min: 1, max: 86400 },
      timestamp("expires_at"),
      // Added inside line 1 (#252): absent means a first attempt.
      { name: "attempt", kinds: Kind.Integer, min: 1, optional: true },
    ],
    extra: offerExtra,
  },

  "job.accept": { fields: [jobId("job"), ulid("offer")] },

  "job.decline": {
    fields: [
      jobId("job"),
      ulid("offer"),
      { name: "reason", kinds: Kind.String, enum: DECLINE },
      detail(512),
    ],
  },

  "job.cancel": {
    fields: [jobId("job"), { name: "reason", kinds: Kind.String, enum: CANCEL }, detail(512)],
  },

  "job.start": {
    fields: [
      jobId("job"),
      { name: "attempt", kinds: Kind.Integer, min: 1 },
      { name: "executor", kinds: Kind.String, enum: EXECUTOR },
      timestamp("started_at"),
      { name: "workspace", kinds: Kind.String, minLen: 1, maxLen: 1024 },
    ],
  },

  "job.progress": {
    fields: [
      jobId("job"),
      { name: "phase", kinds: Kind.String, enum: PHASE },
      percentage("pct"),
      // The one sentence field with no minimum: nothing to say is an empty note, not an absence.
      { name: "note", kinds: Kind.String, maxLen: 256 },
    ],
  },

  "job.finish": {
    fields: [
      jobId("job"),
      { name: "attempt", kinds: Kind.Integer, min: 1 },
      { name: "outcome", kinds: Kind.String, enum: OUTCOME },
      { name: "exit_code", kinds: Kind.Integer | Kind.Null, min: -1, max: 255 },
      timestamp("started_at"),
      timestamp("finished_at"),
      {
        name: "log",
        kinds: Kind.Object,
        fields: [count("bytes"), count("chunks"), count("dropped_bytes")],
      },
      {
        name: "ccache",
        kinds: Kind.Object | Kind.Null,
        fields: [
          count("hits"),
          count("misses"),
          { name: "hit_rate_pct", kinds: Kind.Number, min: 0, max: 100 },
          count("size_mb"),
          count("max_size_mb"),
        ],
      },
      {
        name: "error",
        kinds: Kind.Object | Kind.Null,
        fields: [{ name: "code", kinds: Kind.String, minLen: 1, maxLen: 64 }, detail(1024)],
      },
    ],
    extra: finishExtra,
  },

  "log.chunk": {
    fields: [
      jobId("job"),
      count("seq"),
      { name: "stream", kinds: Kind.String, enum: STREAM },
      { name: "encoding", kinds: Kind.String, enum: ["base64"] },
      { name: "data", kinds: Kind.String, maxLen: LOG_CHUNK_MAX_BASE64_CHARS },
      count("dropped_bytes"),
    ],
    extra: logChunkExtra,
  },

  receipt: {
    fields: [
      ulid("of"),
      { name: "of_type", kinds: Kind.String, enum: ["job.finish"] },
      { name: "duplicate", kinds: Kind.Bool },
    ],
  },

  drain: {
    fields: [
      { name: "reason", kinds: Kind.String, enum: DRAIN },
      count("deadline_ms"),
      detail(512),
    ],
  },

  // An empty payload is an object, never an absence — so the contract is an empty field list,
  // which still refuses an unknown key.
  undrain: { fields: [] },

  bye: {
    fields: [
      { name: "reason", kinds: Kind.String, enum: BYE },
      detail(512),
      { name: "reconnect_after_ms", kinds: Kind.Integer | Kind.Null, min: 0 },
    ],
  },
};

/**
 * Apply a closed object contract at an RFC 6901 prefix: every required field present and
 * legal, and no field the contract does not name.
 *
 * @param prefix - Where the object sits, `/payload` at the top.
 * @param fields - Its contract.
 * @param object - The object.
 * @returns The diagnostics, unsorted.
 */
export function checkObject(
  prefix: string,
  fields: readonly Field[],
  object: Readonly<Record<string, unknown>>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const known = new Set<string>();

  for (const field of fields) {
    known.add(field.name);
    const path = `${prefix}/${escape(field.name)}`;

    if (!Object.hasOwn(object, field.name)) {
      if (!field.optional) diagnostics.push({ code: "payload.field.missing", path });
      continue;
    }

    diagnostics.push(...checkValue(path, field, object[field.name]));
  }

  for (const key of Object.keys(object)) {
    if (!known.has(key)) {
      diagnostics.push({ code: "payload.field.unknown", path: `${prefix}/${escape(key)}` });
    }
  }

  return diagnostics;
}

/**
 * Apply one field's contract to one value.
 *
 * @param path - Where the value sits.
 * @param field - Its contract.
 * @param value - The value, with numbers as {@link WireNumber}s.
 * @returns The diagnostics.
 */
function checkValue(path: string, field: Field, value: unknown): Diagnostic[] {
  const type = (): Diagnostic[] => [{ code: "payload.field.type", path }];

  if (value === null) return field.kinds & Kind.Null ? [] : type();
  if (typeof value === "string")
    return field.kinds & Kind.String ? checkString(path, field, value) : type();
  if (typeof value === "boolean") return field.kinds & Kind.Bool ? [] : type();
  if (value instanceof WireNumber) return checkNumber(path, field, value);
  if (Array.isArray(value))
    return field.kinds & Kind.Array ? checkArray(path, field, value) : type();
  if (typeof value === "object") {
    return field.kinds & Kind.Object
      ? checkMap(path, field, value as Readonly<Record<string, unknown>>)
      : type();
  }

  return type();
}

/**
 * A string field's enum, shape and length — in that order, one diagnostic at most.
 *
 * A value of the right type in the wrong published shape — a job id that is not one — is a
 * *type* error: it is not a value of that shape at all.
 *
 * @param path - Where it sits.
 * @param field - Its contract.
 * @param value - The string.
 * @returns The diagnostics.
 */
function checkString(path: string, field: Field, value: string): Diagnostic[] {
  if (field.enum && !field.enum.includes(value)) return [{ code: "payload.field.enum", path }];
  if (field.pattern && !field.pattern.test(value)) return [{ code: "payload.field.type", path }];

  const length = [...value].length;
  if (
    (field.minLen !== undefined && length < field.minLen) ||
    (field.maxLen !== undefined && length > field.maxLen)
  ) {
    return [{ code: "payload.field.range", path }];
  }

  return [];
}

/**
 * A numeric field's integrality and bounds.
 *
 * @param path - Where it sits.
 * @param field - Its contract.
 * @param value - The number, as written.
 * @returns The diagnostics.
 */
function checkNumber(path: string, field: Field, value: WireNumber): Diagnostic[] {
  if (field.kinds & Kind.Integer) {
    if (!value.integer) return [{ code: "payload.field.type", path }];
  } else if (!(field.kinds & Kind.Number)) {
    return [{ code: "payload.field.type", path }];
  }

  if (
    (field.min !== undefined && value.value < field.min) ||
    (field.max !== undefined && value.value > field.max)
  ) {
    return [{ code: "payload.field.range", path }];
  }

  return [];
}

/**
 * An object field — a closed field list, or an open map whose values share one contract.
 *
 * @param path - Where it sits.
 * @param field - Its contract.
 * @param value - The object.
 * @returns The diagnostics.
 */
function checkMap(
  path: string,
  field: Field,
  value: Readonly<Record<string, unknown>>,
): Diagnostic[] {
  if (!field.value) return checkObject(path, field.fields ?? [], value);

  const diagnostics: Diagnostic[] = [];
  const keys = Object.keys(value);

  if (field.maxProps !== undefined && keys.length > field.maxProps) {
    diagnostics.push({ code: "payload.field.range", path });
  }
  for (const key of keys) {
    diagnostics.push(...checkValue(`${path}/${escape(key)}`, field.value, value[key]));
  }

  return diagnostics;
}

/**
 * An array field's item count and element contract.
 *
 * @param path - Where it sits.
 * @param field - Its contract.
 * @param value - The array.
 * @returns The diagnostics.
 */
function checkArray(path: string, field: Field, value: readonly unknown[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (
    (field.minItems !== undefined && value.length < field.minItems) ||
    (field.maxItems !== undefined && value.length > field.maxItems)
  ) {
    diagnostics.push({ code: "payload.field.range", path });
  }

  if (field.item) {
    value.forEach((item, index) => {
      diagnostics.push(...checkValue(`${path}/${String(index)}`, field.item as Field, item));
    });
  }

  return diagnostics;
}

/**
 * Escape a key for an RFC 6901 pointer.
 *
 * @param key - The key.
 * @returns `~` as `~0` and `/` as `~1`, in that order.
 */
export function escape(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}
