/**
 * The test-results page's states besides *results already parsed*
 * ([#342](https://github.com/NobuData/ouroboros/issues/342)) — decided here, drawn by the screen.
 *
 * Mockup 11 draws one state: a mid-flight build whose results have parsed. A build is also
 * **still reporting** (its counts are what has parsed so far, and must not read as a verdict), a
 * run's workflow may have **no test stage** at all, a report may have **parsed in part** (the
 * page then says what it could not read and what is therefore missing), and a running build's
 * uploads may **go quiet** — DASH-I.7's rule ([#86](https://github.com/NobuData/ouroboros/issues/86))
 * for ingestion, as the run console applies it (`app/runs/states.ts`).
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { TestAttempt, TestParseWarning } from "@/app/api/test-results";
import { INGEST_LAG_AFTER_SECONDS } from "@/app/runs/states";

import { buildLabel } from "./view";

// --- a build that is still running --------------------------------------------------------

/** The label a running build's figures wear. */
export const PARTIAL_LABEL = "partial";

/**
 * What a running build's figures are, in words.
 *
 * @param attempt The attempt the page reads.
 * @returns `Build 3 is still running — …`, or `null` for an attempt that has finished, whose
 *   figures are final.
 */
export function partialNote(attempt: TestAttempt): string | null {
  if (attempt.status !== "running") return null;

  const build = buildLabel(attempt.attemptSeq);
  const { total } = attempt.strip;
  const soFar =
    total === 0
      ? "no case has been reported yet"
      : `${total} ${total === 1 ? "case has" : "cases have"} been reported so far`;

  return `${build} is still running — ${soFar}. These figures are what has parsed, not the final result, and will move until the build completes.`;
}

// --- a run with nothing to show -----------------------------------------------------------

/** The empty state's heading for a workflow that does not test. */
export const NO_TEST_STAGE_TITLE = "This run's workflow has no test stage.";

/** The empty state's heading for a run that has reported nothing. */
export const NO_RESULTS_TITLE = "No test results yet.";

/** What a run that has reported nothing is waiting on. */
export const NO_RESULTS_NOTE =
  "No build of this run has reported test results yet. They appear here as soon as the first " +
  "build uploads its reports.";

/** The way to the run's console. */
export const OPEN_RUN_CONSOLE = "Open the run console";

/** The way to the run's workflow. */
export const OPEN_WORKFLOW = "Open the workflow";

/**
 * Why a run whose workflow has no test stage has no results.
 *
 * @param workflow The workflow's caption — `standard-fix v14`.
 * @returns The sentence.
 */
export function noTestStageNote(workflow: string): string {
  return `${workflow} runs no test stage, so this run produces no test results. Add a test stage to the workflow to see results here.`;
}

/** Which empty state a run with no attempt draws. */
export type EmptyKind = "no-test-stage" | "no-results";

/**
 * Which empty state a run with no attempt draws.
 *
 * @param hasTestStage Whether the run's stages include the test stage; `null` when the run's
 *   stages could not be read.
 * @returns `no-test-stage` only when the stages were read and none is the test stage — unknown is
 *   never reported as absent.
 */
export function emptyKind(hasTestStage: boolean | null): EmptyKind {
  return hasTestStage === false ? "no-test-stage" : "no-results";
}

// --- an attempt the address names that does not exist -------------------------------------

/**
 * What became of an `?attempt=` that names no build of this run.
 *
 * @param requested The ordinal the address asked for, or `null`.
 * @param attempt The attempt the page reads instead, or `null` before any.
 * @returns `Build 9 does not exist for this run — showing Build 4, the latest.`, or `null` when
 *   the address named nothing, or named the attempt on screen.
 */
export function unknownAttemptNote(
  requested: number | null,
  attempt: TestAttempt | null,
): string | null {
  if (requested === null || attempt === null || attempt.attemptSeq === requested) return null;

  return `${buildLabel(requested)} does not exist for this run — showing ${buildLabel(attempt.attemptSeq)}, the latest.`;
}

// --- a report that parsed in part ---------------------------------------------------------

/** The parse-warning banner's accessible name. */
export const PARSE_WARNINGS_LABEL = "Parse warnings";

/** What each warning leaves missing from the page — the parser's own rule for it (#329). */
export const PARSE_WARNING_MISSING: Readonly<Record<TestParseWarning["code"], string>> = {
  format_unrecognized: "The file was ignored, so none of its results are shown.",
  xml_truncated: "The file ended early, so every case after the break is missing.",
  xml_malformed: "The file is not well-formed, so every case after the fault is missing.",
  junit_platform_missing: "Nothing is missing, but its cases are filed under an unknown platform.",
  hil_json_malformed: "The file is not JSON, so none of its physical results are shown.",
  hil_schema_version_unknown:
    "The file's schema version is not known, so none of its physical results are shown.",
  hil_schema_invalid: "The element that broke the schema is missing; the rest was kept.",
  hil_measurement_incomplete: "The incomplete measurement is missing; the rest was kept.",
  coverage_unreadable: "The report gave no line counts, so it is missing from the coverage figure.",
};

/** One warning, ready to draw. */
export interface ParseWarningView {
  /** A key that is stable for the list. */
  readonly key: string;
  /** The file it is about — `junit-telemetry.xml`. */
  readonly file: string;
  /** Where in the file — `line 212` — or `null` when the format did not say. */
  readonly at: string | null;
  /** What failed to parse, in the parser's words. */
  readonly failed: string;
  /** What is therefore missing from the page. */
  readonly missing: string;
}

/** The banner, ready to draw. */
export interface ParseWarningsView {
  /** `2 report files could not be fully read — Build 3's results are incomplete.` */
  readonly headline: string;
  readonly warnings: readonly ParseWarningView[];
}

/**
 * The parse-warning banner for one attempt.
 *
 * @param warnings The attempt's warnings, as the payload states them.
 * @param attempt The attempt they belong to.
 * @returns The banner, or `null` when the parser read everything.
 */
export function parseWarningsView(
  warnings: readonly TestParseWarning[],
  attempt: TestAttempt,
): ParseWarningsView | null {
  if (warnings.length === 0) return null;

  const files = new Set(warnings.map((each) => each.file)).size;
  const subject = files === 1 ? "1 report file" : `${files} report files`;
  const { total } = attempt.strip;
  const shown = `${total} ${total === 1 ? "case" : "cases"} parsed and ${total === 1 ? "is" : "are"} shown`;

  return {
    headline: `${subject} could not be fully read — ${buildLabel(attempt.attemptSeq)}'s results are incomplete: ${shown}, and what is listed here is missing.`,
    warnings: warnings.map((each, index) => ({
      key: `${index}:${each.file}:${each.code}`,
      file: each.file,
      at: each.at ?? null,
      failed: each.message,
      missing: PARSE_WARNING_MISSING[each.code],
    })),
  };
}

// --- uploads that have gone quiet ---------------------------------------------------------

/** What the ingest-lag banner's retry says — it asks the service again, now. */
export const TESTS_LAG_RETRY = "Check again";

/** What the ingest-lag banner's retry says while that read is in flight. */
export const TESTS_LAG_RETRYING = "Checking…";

/**
 * Why a running build's uploads may have gone quiet — the banner's reason. It names every cause
 * it cannot rule out, because it can rule out none of them.
 */
export const TESTS_LAG_REASON =
  "The build may be on a long test, or its job may have died, or ingestion may have stalled. " +
  "What is shown here may be out of date.";

/**
 * When a running attempt's uploads went stale, if they have.
 *
 * Only a running attempt can lag: one that has finished is supposed to be quiet.
 *
 * @param attempt The attempt the page reads.
 * @param nowMs Now, in epoch milliseconds.
 * @param afterSeconds How long counts as stale. Defaults to the run console's
 *   `INGEST_LAG_AFTER_SECONDS`.
 * @returns When a report last arrived, in epoch milliseconds, when that is older than
 *   `afterSeconds`; else `null` — also when the instant cannot be parsed.
 */
export function testsLagSince(
  attempt: TestAttempt,
  nowMs: number,
  afterSeconds: number = INGEST_LAG_AFTER_SECONDS,
): number | null {
  if (attempt.status !== "running") return null;

  const last = Date.parse(attempt.lastReceivedAt);
  if (Number.isNaN(last) || nowMs - last < afterSeconds * 1000) return null;

  return last;
}

/**
 * The ingest-lag banner's headline — when a report last arrived.
 *
 * @param sinceMs When the last report arrived, in epoch milliseconds.
 * @param attemptSeq The attempt's ordinal.
 * @param clock How to print an instant — the dashboard's `clockTime`.
 * @returns `No results received since 14:02 — Build 3's uploads have gone quiet.`
 */
export function testsLagHeadline(
  sinceMs: number,
  attemptSeq: number,
  clock: (atMs: number) => string,
): string {
  return `No results received since ${clock(sinceMs)} — ${buildLabel(attemptSeq)}'s uploads have gone quiet.`;
}
