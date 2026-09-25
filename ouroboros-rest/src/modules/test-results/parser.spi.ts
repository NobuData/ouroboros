/**
 * The `TestResultParser` SPI — what turns one uploaded file into normalized suites, cases,
 * measurements and coverage counts (AT.1, [#329](https://github.com/NobuData/ouroboros/issues/329)).
 *
 * ## The contract
 *
 * A parser answers two questions about a {@link ResultFile}: *is this mine?* ({@link
 * TestResultParser.detect}) and *what does it say?* ({@link TestResultParser.parse}). It never
 * touches the database, never reads another file and never throws on bad input — whatever it
 * could not read becomes a {@link ParseWarning} beside whatever it could, because **partial
 * results beat no results, and a silent partial is worse than either.**
 *
 * A parser reports **raw attempts**. A case retried twice is `outcomes: ["failed", "failed",
 * "passed"]`, not a status: which of those retries were sanctioned is the pinned `flakes:`
 * policy's question (decision **T5**), and `flake-policy.ts` answers it once for every format.
 *
 * ## Adding a format
 *
 * Implement this interface and add the instance to `TEST_RESULT_PARSERS` in
 * `test-results.module.ts`. Nothing else changes — `test-results.registry.spec.ts` proves it by
 * registering a stub TAP parser that exists only in the test suite.
 */

import type { TestAttemptOutcome, TestCaseFailure, TestSuiteKind } from "../db/schema";
import type { FlakePolicy } from "./flake-policy";

/** One uploaded file, as the upload manifest (#330) hands it over. */
export interface ResultFile {
  /** Its name in the manifest — `junit-build3.xml`, `ouro-hil-results.json`, `lcov.info`. */
  readonly name: string;
  /** Its bytes. */
  readonly bytes: Uint8Array;
}

/** What a parse is told about the attempt it parses for. */
export interface ParseContext {
  /**
   * Which retries the pinned workflow sanctioned. Parsers report raw attempts and the orchestrator
   * applies this; it is here for a format that carries its own notion of a sanctioned retry.
   */
  readonly flakePolicy: FlakePolicy;
}

/**
 * Every warning a parse can attach to `test_runs.parse_warnings` — the malformed-input taxonomy.
 * Each keeps whatever parsed successfully; none refuses the upload set.
 */
export const PARSE_WARNING_CODES = [
  /** No registered parser recognised the file. It is ignored. */
  "format_unrecognized",
  /** The XML ended mid-document. Every element that closed is kept. */
  "xml_truncated",
  /** The XML is not well-formed. Every element that closed before the fault is kept. */
  "xml_malformed",
  /** A JUnit suite named no platform. Its cases are recorded under `unknown`. */
  "junit_platform_missing",
  /** The HIL document is not JSON at all. Nothing in it is kept. */
  "hil_json_malformed",
  /** The HIL document names a schema version this build does not know. Nothing in it is kept. */
  "hil_schema_version_unknown",
  /** A HIL document, suite or case broke the schema. That element is dropped, the rest kept. */
  "hil_schema_invalid",
  /** A HIL measurement is missing a required field or holds a bad one. It alone is dropped. */
  "hil_measurement_incomplete",
  /** A coverage report gave no line counts. It contributes nothing to the percentage. */
  "coverage_unreadable",
] as const;

/** One of {@link PARSE_WARNING_CODES}. */
export type ParseWarningCode = (typeof PARSE_WARNING_CODES)[number];

/** One entry of `test_runs.parse_warnings` — typed, so the UI's banner can say what went wrong. */
export interface ParseWarning {
  /** What class of malformed input it is. */
  readonly code: ParseWarningCode;
  /** The manifest name of the file it is about. */
  readonly file: string;
  /** A sentence a person can read. */
  readonly message: string;
  /** Where in the file, when the format has a notion of where — `line 212`, `/suites/0/cases/1`. */
  readonly at?: string;
}

/** One HIL measurement, verdict already computed (`hil_verdict` in V053). */
export interface NormalizedMeasurement {
  /** `overshoot_pct`. Unique within its case. */
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
  readonly limitValue: number;
  readonly limitKind: "max" | "min";
  readonly verdict: "pass" | "fail";
  /** Trial objects in the order they ran. */
  readonly trials: readonly Record<string, unknown>[];
}

/** What a HIL document adds to a case. */
export interface NormalizedHil {
  /** The what-it-did line. */
  readonly procedure: string;
  readonly measurements: readonly NormalizedMeasurement[];
}

/** One test case as a parser read it — attempts raw, before the flake policy. */
export interface NormalizedCase {
  /** Trimmed; never blank. */
  readonly name: string;
  /** Trimmed, or null when the format has none. */
  readonly classname: string | null;
  /** Every attempt's outcome in order, the first included. Never empty. */
  readonly outcomes: readonly TestAttemptOutcome[];
  /** Summed over its attempts, or null when the report gave no time. */
  readonly durationMs: number | null;
  /** The last non-passing attempt's payload, or null. */
  readonly failure: TestCaseFailure | null;
  /** What the format knows that the tree has no column for. */
  readonly meta: Readonly<Record<string, unknown>>;
  /** Present only on a case a HIL document described. */
  readonly hil?: NormalizedHil;
}

/** One suite on one platform. */
export interface NormalizedSuite {
  /** Trimmed; never blank. */
  readonly name: string;
  /** Normalized to V051's `test_suites_platform_shape`. */
  readonly platform: string;
  /** `physical` exactly when the platform is a `rig:`. */
  readonly kind: TestSuiteKind;
  /** `hil` when a HIL document described it. */
  readonly format: "junit" | "hil";
  /** The suite's own time, or the sum of its cases', or null when neither is known. */
  readonly durationMs: number | null;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly cases: readonly NormalizedCase[];
}

/** A coverage report's two numbers — every figure the card prints is arithmetic over them. */
export interface CoverageCounts {
  /** The file it came from. */
  readonly file: string;
  readonly linesCovered: number;
  /** Greater than zero: an empty report has no percentage and is a warning instead. */
  readonly linesTotal: number;
}

/** What one parse of one file produced. */
export interface ParseOutput {
  readonly suites: readonly NormalizedSuite[];
  readonly coverage: readonly CoverageCounts[];
  readonly warnings: readonly ParseWarning[];
}

/** A result format. See this file's header. */
export interface TestResultParser {
  /** A stable name — `junit`, `hil`, `coverage`. Unique within the registry. */
  readonly id: string;
  /**
   * Whether this parser reads the file. Cheap: a name and the first few kilobytes, never a parse.
   *
   * @param file - The file.
   * @returns True when {@link parse} should be given it.
   */
  detect(file: ResultFile): boolean;
  /**
   * Read the file. Never throws on bad input — see this file's header.
   *
   * @param file - The file {@link detect} accepted.
   * @param ctx - The attempt's context.
   * @returns What it says, and what could not be read.
   */
  parse(file: ResultFile, ctx: ParseContext): ParseOutput;
}

/** How much of a file {@link TestResultParser.detect} implementations look at. */
export const DETECT_WINDOW_BYTES = 4096;

/**
 * The first {@link DETECT_WINDOW_BYTES} of a file as text — what detection sniffs.
 *
 * @param file - The file.
 * @returns Its head, decoded as UTF-8 (a split character at the cut becomes U+FFFD).
 */
export function headOf(file: ResultFile): string {
  return Buffer.from(file.bytes.subarray(0, DETECT_WINDOW_BYTES)).toString("utf8");
}

/**
 * A whole file as text.
 *
 * @param file - The file.
 * @returns It, decoded as UTF-8.
 */
export function textOf(file: ResultFile): string {
  return Buffer.from(file.bytes).toString("utf8");
}

/** A parse that read nothing — the start every parser builds on. */
export const EMPTY_OUTPUT: ParseOutput = Object.freeze({
  suites: [],
  coverage: [],
  warnings: [],
});
