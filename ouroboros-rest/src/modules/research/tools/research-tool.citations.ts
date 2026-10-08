/**
 * The citation contract, as code — what makes a `ToolResult` acceptable.
 *
 * CL.1 ([#614](https://github.com/NobuData/ouroboros/issues/614)), decision **V3**. Two callers
 * hold a result to these rules: the conformance kit, against every adapter's recorded fixtures,
 * and the internal tool surface, against every live answer before a source reaches the ledger.
 * The rules are V108's (`source_records`, #609) restated so a malformed source is refused with a
 * sentence naming it rather than with a constraint name from the database — and, first of all,
 * the rule V108 cannot state: **a payload comes with at least one source**. The one exception is
 * the empty answer — a `null` payload, a search that found nothing — which has nothing to cite.
 *
 * Every check is a `…Violations(…) => string[]`, the kit's convention: one run reports every
 * problem, and the checks are testable against results that are wrong on purpose.
 */

import { SOURCE_RECORD_KINDS, type SourceRecordKind } from "./research-tool.adapter";

/** V108's bounds. */
export const SOURCE_LIMITS = {
  /** `source_records_title_present`. */
  titleChars: 300,
  /** `source_locator_valid`. */
  locatorChars: 2048,
  /** `source_records_excerpt_bounded` — bytes, not characters. */
  excerptBytes: 4096,
  /** `source_records_meta_shape` — bytes of the jsonb text. */
  metaBytes: 8192,
} as const;

const HTTP = /^https?:\/\/[A-Za-z0-9.-]+(:[0-9]+)?(\/.*)?$/;
const ISSUE_INDEX = /^issue-index:\/\/[a-z0-9][a-z0-9_-]*(\/[A-Za-z0-9._#-]+)+$/;
const GIT =
  /^git:\/\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?@[0-9a-f]{7,40}(\/[A-Za-z0-9._-]+)*(#L[1-9][0-9]*(-L[1-9][0-9]*)?)?$/;
const GIT_DOT_SEGMENT = /\/\.\.?(\/|#|$)/;
const DATE = "[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}(:[0-9]{2})?Z)?";
const TELEMETRY = new RegExp(
  `^telemetry://[a-z0-9][a-z0-9_.-]*(/[a-z0-9][a-z0-9_.-]*)*/([1-9][0-9]*[hdw]|${DATE}\\.\\.${DATE})$`,
);
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a locator is well-formed for its kind — V108's `source_locator_valid()`.
 *
 * @param kind - The source kind.
 * @param locator - The URL or internal URI.
 * @returns `true` when the database would accept it.
 */
export function locatorValid(kind: SourceRecordKind, locator: string): boolean {
  if (locator.length > SOURCE_LIMITS.locatorChars || /\s/.test(locator)) {
    return false;
  }

  switch (kind) {
    case "web":
    case "competitor_diff":
    case "doc":
      return HTTP.test(locator);
    case "ticket":
      return ISSUE_INDEX.test(locator) || HTTP.test(locator);
    case "code":
      return GIT.test(locator) && !GIT_DOT_SEGMENT.test(locator);
    case "telemetry":
      return TELEMETRY.test(locator);
  }
}

/**
 * The length in bytes of a value's PostgreSQL `jsonb` text — what `octet_length(meta::text)`
 * measures. `jsonb` prints `": "` and `", "` where `JSON.stringify` prints `:` and `,`, so the
 * plain JSON length would undercount and let a value through that the database refuses.
 *
 * @param value - A JSON value.
 * @returns Its byte length as `jsonb` text.
 */
export function jsonbTextBytes(value: unknown): number {
  const text = (node: unknown): string => {
    if (Array.isArray(node)) {
      return `[${node.map(text).join(", ")}]`;
    }

    if (typeof node === "object" && node !== null) {
      return `{${Object.entries(node)
        .map(([key, item]) => `${JSON.stringify(key)}: ${text(item)}`)
        .join(", ")}}`;
    }

    return JSON.stringify(node) ?? "null";
  };

  return Buffer.byteLength(text(value), "utf8");
}

/**
 * Everything wrong with one source record.
 *
 * @param record - What the adapter returned. `unknown`: an adapter in JavaScript, or against an
 *   older interface, was not stopped by the compiler.
 * @param label - How to name it in a sentence — `source 2`.
 * @returns The violations; empty when the ledger would accept it.
 */
export function sourceRecordViolations(record: unknown, label = "source"): string[] {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return [`${label}: must be an object`];
  }

  const source = record as Record<string, unknown>;
  const violations: string[] = [];
  const complain = (message: string): void => {
    violations.push(`${label}: ${message}`);
  };

  const kind = source.kind;
  const kindValid =
    typeof kind === "string" && (SOURCE_RECORD_KINDS as readonly string[]).includes(kind);

  if (!kindValid) {
    complain(`kind must be one of ${SOURCE_RECORD_KINDS.join(", ")}`);
  }

  if (
    typeof source.title !== "string" ||
    source.title.trim() === "" ||
    source.title.length > SOURCE_LIMITS.titleChars
  ) {
    complain(
      `title must be non-blank and at most ${SOURCE_LIMITS.titleChars.toString()} characters`,
    );
  }

  if (typeof source.locator !== "string") {
    complain("locator must be a string");
  } else if (kindValid && !locatorValid(kind as SourceRecordKind, source.locator)) {
    complain(`locator is not well-formed for a ${String(kind)} source`);
  }

  if (typeof source.retrievedAt !== "string" || Number.isNaN(Date.parse(source.retrievedAt))) {
    complain("retrievedAt must be an ISO-8601 timestamp");
  }

  if (typeof source.contentHash !== "string" || !SHA256.test(source.contentHash)) {
    complain("contentHash must be sha256:<64 lowercase hex>");
  }

  if (
    typeof source.excerpt !== "string" ||
    source.excerpt.trim() === "" ||
    Buffer.byteLength(source.excerpt, "utf8") > SOURCE_LIMITS.excerptBytes
  ) {
    complain(
      `excerpt must be non-blank and at most ${SOURCE_LIMITS.excerptBytes.toString()} bytes`,
    );
  }

  const meta = source.meta;

  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    complain("meta must be an object");
  } else if (jsonbTextBytes(meta) > SOURCE_LIMITS.metaBytes) {
    complain(`meta must be at most ${SOURCE_LIMITS.metaBytes.toString()} bytes`);
  }

  // V112: a competitor_diff source names the archived snapshot it cites, and only it may.
  const snapshot = source.snapshotId;

  if (kind === "competitor_diff") {
    if (typeof snapshot !== "string" || !UUID.test(snapshot)) {
      complain("a competitor_diff source must name the snapshot it cites (snapshotId, a uuid)");
    }
  } else if (snapshot !== undefined) {
    complain("only a competitor_diff source names a snapshot");
  }

  return violations;
}

/**
 * Everything wrong with an operation's answer — the citation contract.
 *
 * @param result - What the operation resolved to.
 * @param tokenCeiling - The most tokens the call was allowed, or null for no ceiling.
 * @returns The violations; empty when the result may be archived and returned.
 */
export function resultViolations(result: unknown, tokenCeiling: number | null): string[] {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return ["result must be an object of {payload, sources, usage}"];
  }

  const answer = result as Record<string, unknown>;
  const violations: string[] = [];

  if (answer.payload === undefined) {
    violations.push("result must carry a payload (null for an empty answer)");
  }

  const sources = answer.sources;

  if (!Array.isArray(sources)) {
    violations.push("sources must be an array");
  } else {
    // The rule this whole file exists for: data with no evidence behind it is not an answer.
    // A null payload is the one honest empty answer — a search with no hits read nothing.
    if (sources.length === 0 && answer.payload !== null) {
      violations.push("an operation that returns a payload must return at least one source record");
    }

    sources.forEach((source, index) => {
      violations.push(...sourceRecordViolations(source, `source ${(index + 1).toString()}`));
    });
  }

  const usage = answer.usage as Record<string, unknown> | null | undefined;
  const tokens = typeof usage === "object" && usage !== null ? usage.tokens : undefined;

  if (typeof tokens !== "number" || !Number.isInteger(tokens) || tokens < 0) {
    violations.push("usage.tokens must be a non-negative integer");
  } else if (tokenCeiling !== null && tokens > tokenCeiling) {
    violations.push(
      `usage.tokens (${tokens.toString()}) exceeds the call's ceiling of ${tokenCeiling.toString()}`,
    );
  }

  return violations;
}
