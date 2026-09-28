/**
 * The test-results page's polls — `app/poll.ts`'s loop over one run's attempts, over one
 * attempt's re-run gate ([#335](https://github.com/NobuData/ouroboros/issues/335)), over one
 * attempt's page, for its suites ([#337](https://github.com/NobuData/ouroboros/issues/337)), and
 * over one attempt's triage hints and one case's failure
 * ([#339](https://github.com/NobuData/ouroboros/issues/339)).
 *
 * `app/runs/console-poll.ts` is the same file for the run console, and the argument is the
 * same: the page is the browser asking, on the shared I.8 cadence
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)), for what it has open — so a running
 * build's strip moves without a reload.
 *
 * **Loops keyed differently, on purpose.** The timeline is the *run's*: it carries every
 * attempt's strip, so switching attempts redraws the head and the strip from the answer already
 * held, in the same render. The gate is the *attempt's*: it is rebuilt the moment the attempt
 * changes, and until its first answer the actions say they are checking — a gate read for
 * Build 2 is never drawn under Build 3's head. The page is the attempt's for the same reason:
 * Build 2's suites are never drawn under Build 3's head. The hints are the attempt's too, and
 * the failure is the *case's* — keyed on the attempt and the case together
 * ({@link failureKey}), so one case's log is never drawn under another's path.
 *
 * **Framework-free**, so each reader is a unit test against a stubbed `fetch`; the screen meets
 * them through `app/issues/use-keyed-poll.ts`.
 */

import type {
  RerunAvailability,
  TestCaseFailureDetail,
  TestRunHints,
  TestRunPage,
  TestRunTimeline,
} from "@/app/api/test-results";
import {
  type Poll,
  type PollOptions,
  type PollReader,
  createPoll,
  requestPayload,
} from "@/app/poll";

/** Where the browser asks for a run's timeline — this origin, `/api/runs/:id/tests`. */
export const TIMELINE_ENDPOINT = "/api/runs";

/** Where the browser asks for an attempt's gate — this origin, `/api/test-runs/:id/rerun`. */
export const GATE_ENDPOINT = "/api/test-runs";

/** Where the browser asks for an attempt's page — this origin, `/api/test-runs/:id`. */
export const PAGE_ENDPOINT = "/api/test-runs";

/** Where the browser asks for a case's failure — `/api/test-runs/:id/cases/:caseId/failure`. */
export const FAILURE_ENDPOINT = "/api/test-runs";

/** Where the browser asks for an attempt's triage hints — `/api/test-runs/:id/hints`. */
export const HINTS_ENDPOINT = "/api/test-runs";

/** What is said when something answered and this client could not read it as a failure. */
export const UNREADABLE_FAILURE = "The failure could not be read.";

/** What is said when nothing answered the failure's read at all. */
export const UNREACHABLE_FAILURE = "The failure could not be reached.";

/** What is said when something answered and this client could not read it as triage hints. */
export const UNREADABLE_HINTS = "The triage hint could not be read.";

/** What is said when nothing answered the hints' read at all. */
export const UNREACHABLE_HINTS = "The triage hint could not be reached.";

/** What is said when something answered and this client could not read it as an attempt's page. */
export const UNREADABLE_PAGE = "The suites could not be read.";

/** What is said when nothing answered the page's read at all. */
export const UNREACHABLE_PAGE = "The suites could not be reached.";

/** What is said when something answered and this client could not read it as a timeline. */
export const UNREADABLE_TIMELINE = "The test results could not be read.";

/** What is said when nothing answered the timeline's read at all. */
export const UNREACHABLE_TIMELINE = "The test results could not be reached.";

/** What is said when something answered and this client could not read it as a gate. */
export const UNREADABLE_GATE = "Whether a runner is available could not be read.";

/** What is said when nothing answered the gate's read at all. */
export const UNREACHABLE_GATE = "Whether a runner is available could not be checked.";

/** How to build either poll. Everything is optional; production supplies none of it. */
export interface TestsPollOptions<T> extends PollOptions {
  /** How to make one read. Defaults to the address's own reader. */
  read?: PollReader<T>;
}

/**
 * The address the page polls for a run's timeline.
 *
 * @param runId The run's id.
 * @returns `/api/runs/<id>/tests`, the id encoded.
 */
export function timelineUrl(runId: string): string {
  return `${TIMELINE_ENDPOINT}/${encodeURIComponent(runId)}/tests`;
}

/**
 * The address the page polls for an attempt's re-run gate.
 *
 * @param testRunId The attempt's id.
 * @returns `/api/test-runs/<id>/rerun`, the id encoded.
 */
export function gateUrl(testRunId: string): string {
  return `${GATE_ENDPOINT}/${encodeURIComponent(testRunId)}/rerun`;
}

/**
 * The address the page polls for an attempt's page.
 *
 * @param testRunId The attempt's id.
 * @returns `/api/test-runs/<id>`, the id encoded.
 */
export function pageUrl(testRunId: string): string {
  return `${PAGE_ENDPOINT}/${encodeURIComponent(testRunId)}`;
}

/**
 * The address the page polls for a case's failure.
 *
 * @param testRunId The attempt's id.
 * @param caseId The case's id in that attempt.
 * @returns `/api/test-runs/<id>/cases/<caseId>/failure`, both ids encoded.
 */
export function failureUrl(testRunId: string, caseId: string): string {
  return `${FAILURE_ENDPOINT}/${encodeURIComponent(testRunId)}/cases/${encodeURIComponent(caseId)}/failure`;
}

/**
 * The address the page polls for an attempt's triage hints.
 *
 * @param testRunId The attempt's id.
 * @returns `/api/test-runs/<id>/hints`, the id encoded.
 */
export function hintsUrl(testRunId: string): string {
  return `${HINTS_ENDPOINT}/${encodeURIComponent(testRunId)}/hints`;
}

/** What separates the attempt from the case in a failure poll's key — in no uuid. */
const FAILURE_KEY_SEPARATOR = "/";

/**
 * What a failure's poll is keyed on: the attempt and the case, together.
 *
 * @param testRunId The attempt's id.
 * @param caseId The case's id in that attempt.
 * @returns The key, for `useKeyedPoll`.
 */
export function failureKey(testRunId: string, caseId: string): string {
  return `${testRunId}${FAILURE_KEY_SEPARATOR}${caseId}`;
}

/**
 * Read a failure poll's key back.
 *
 * @param key A key from {@link failureKey}.
 * @returns The attempt's id and the case's — the case's empty for a key that names none.
 */
export function failureKeyParts(key: string): { readonly testRunId: string; readonly caseId: string } {
  const at = key.indexOf(FAILURE_KEY_SEPARATOR);

  return at < 0
    ? { testRunId: key, caseId: "" }
    : { testRunId: key.slice(0, at), caseId: key.slice(at + FAILURE_KEY_SEPARATOR.length) };
}

/**
 * Whether a value is a string or `null` — what every optional field of a failure is.
 *
 * @param value A field.
 * @returns `true` for either.
 */
function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * Whether a parsed body is a case's failure.
 *
 * Structural rather than exhaustive: the failure-detail card reaches for the ids, the name and
 * the three optional texts, and a body carrying those is the failure for every purpose it has.
 *
 * @param value A parsed response body.
 * @returns `true` when it can be read as a {@link TestCaseFailureDetail}.
 */
export function isCaseFailure(value: unknown): value is TestCaseFailureDetail {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.testRunId === "string" &&
    typeof candidate.caseId === "string" &&
    typeof candidate.name === "string" &&
    isTextOrNull(candidate.classname) &&
    isTextOrNull(candidate.message) &&
    isTextOrNull(candidate.logExcerpt) &&
    isTextOrNull(candidate.path)
  );
}

/**
 * Whether a parsed body is an attempt's triage hints.
 *
 * Structural rather than exhaustive: each entry must name its case and carry a `hint` and a
 * `triage` that are objects or `null`. What is *inside* them is read field by field, and
 * defensively, by `failure.ts` — the honesty rule is decided there, not assumed here.
 *
 * @param value A parsed response body.
 * @returns `true` when it can be read as {@link TestRunHints}.
 */
export function isTestRunHints(value: unknown): value is TestRunHints {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<TestRunHints>;

  return (
    typeof candidate.testRunId === "string" &&
    Array.isArray(candidate.cases) &&
    candidate.cases.every((each: unknown) => {
      if (typeof each !== "object" || each === null) return false;

      const row = each as Record<string, unknown>;

      return (
        typeof row.caseId === "string" &&
        (row.hint === null || typeof row.hint === "object") &&
        (row.triage === null || typeof row.triage === "object")
      );
    })
  );
}

/**
 * Whether a parsed body is an attempt's page.
 *
 * Structural rather than exhaustive: the suites card reaches for the attempt's id and each
 * suite's name, platform, kind, counts and cases, and a body carrying those is the page for every
 * purpose it has.
 *
 * @param value A parsed response body.
 * @returns `true` when it can be read as a {@link TestRunPage}.
 */
export function isTestRunPage(value: unknown): value is TestRunPage {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<TestRunPage>;

  return (
    typeof candidate.testRun === "object" &&
    candidate.testRun !== null &&
    typeof candidate.testRun.id === "string" &&
    Array.isArray(candidate.suites) &&
    candidate.suites.every((suite: unknown) => {
      if (typeof suite !== "object" || suite === null) return false;

      const row = suite as Record<string, unknown>;
      const counts = row.counts as Record<string, unknown> | null | undefined;

      return (
        typeof row.id === "string" &&
        typeof row.name === "string" &&
        typeof row.platform === "string" &&
        typeof row.kind === "string" &&
        typeof counts === "object" &&
        counts !== null &&
        typeof counts.total === "number" &&
        typeof counts.passed === "number" &&
        Array.isArray(row.cases)
      );
    })
  );
}

/**
 * Whether a parsed body is a timeline.
 *
 * Structural rather than exhaustive: the head and the strip reach for `run` and each attempt's
 * `strip`, and a body carrying those is the timeline for every purpose they have.
 *
 * @param value A parsed response body.
 * @returns `true` when it can be read as a {@link TestRunTimeline}.
 */
export function isTestRunTimeline(value: unknown): value is TestRunTimeline {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<TestRunTimeline>;

  return (
    typeof candidate.run === "object" &&
    candidate.run !== null &&
    typeof candidate.run.loopSeq === "number" &&
    Array.isArray(candidate.attempts) &&
    candidate.attempts.every(
      (attempt: unknown) =>
        typeof attempt === "object" &&
        attempt !== null &&
        typeof (attempt as { id?: unknown }).id === "string" &&
        typeof (attempt as { attemptSeq?: unknown }).attemptSeq === "number" &&
        typeof (attempt as { strip?: unknown }).strip === "object" &&
        (attempt as { strip?: unknown }).strip !== null,
    )
  );
}

/**
 * Whether a parsed body is a re-run gate.
 *
 * @param value A parsed response body.
 * @returns `true` when it can be read as a {@link RerunAvailability}.
 */
export function isRerunAvailability(value: unknown): value is RerunAvailability {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<RerunAvailability>;

  return (
    typeof candidate.testRunId === "string" &&
    typeof candidate.readiness === "string" &&
    typeof candidate.failedCases === "number" &&
    typeof candidate.fullCases === "number"
  );
}

/**
 * Build the timeline's loop over one run.
 *
 * @param runId The run's id.
 * @param options Test seams; production passes none.
 * @returns The poll. It is inert until `start` is called.
 */
export function createTimelinePoll(
  runId: string,
  options: TestsPollOptions<TestRunTimeline> = {},
): Poll<TestRunTimeline> {
  const url = timelineUrl(runId);
  const read: PollReader<TestRunTimeline> =
    options.read ??
    ((etag) =>
      requestPayload(url, etag, isTestRunTimeline, {
        unreachable: UNREACHABLE_TIMELINE,
        unreadable: UNREADABLE_TIMELINE,
      }));

  return createPoll(read, options);
}

/**
 * Build the gate's loop over one attempt.
 *
 * @param testRunId The attempt's id.
 * @param options Test seams; production passes none.
 * @returns The poll. It is inert until `start` is called.
 */
export function createGatePoll(
  testRunId: string,
  options: TestsPollOptions<RerunAvailability> = {},
): Poll<RerunAvailability> {
  const url = gateUrl(testRunId);
  const read: PollReader<RerunAvailability> =
    options.read ??
    ((etag) =>
      requestPayload(url, etag, isRerunAvailability, {
        unreachable: UNREACHABLE_GATE,
        unreadable: UNREADABLE_GATE,
      }));

  return createPoll(read, options);
}

/**
 * Build the page's loop over one attempt ([#337](https://github.com/NobuData/ouroboros/issues/337)).
 *
 * @param testRunId The attempt's id.
 * @param options Test seams; production passes none.
 * @returns The poll. It is inert until `start` is called.
 */
export function createPagePoll(
  testRunId: string,
  options: TestsPollOptions<TestRunPage> = {},
): Poll<TestRunPage> {
  const url = pageUrl(testRunId);
  const read: PollReader<TestRunPage> =
    options.read ??
    ((etag) =>
      requestPayload(url, etag, isTestRunPage, {
        unreachable: UNREACHABLE_PAGE,
        unreadable: UNREADABLE_PAGE,
      }));

  return createPoll(read, options);
}

/**
 * Build the failure's loop over one case of one attempt
 * ([#339](https://github.com/NobuData/ouroboros/issues/339)).
 *
 * @param key The attempt and the case, from {@link failureKey}.
 * @param options Test seams; production passes none.
 * @returns The poll. It is inert until `start` is called.
 */
export function createFailurePoll(
  key: string,
  options: TestsPollOptions<TestCaseFailureDetail> = {},
): Poll<TestCaseFailureDetail> {
  const { testRunId, caseId } = failureKeyParts(key);
  const url = failureUrl(testRunId, caseId);
  const read: PollReader<TestCaseFailureDetail> =
    options.read ??
    ((etag) =>
      requestPayload(url, etag, isCaseFailure, {
        unreachable: UNREACHABLE_FAILURE,
        unreadable: UNREADABLE_FAILURE,
      }));

  return createPoll(read, options);
}

/**
 * Build the hints' loop over one attempt
 * ([#339](https://github.com/NobuData/ouroboros/issues/339)).
 *
 * @param testRunId The attempt's id.
 * @param options Test seams; production passes none.
 * @returns The poll. It is inert until `start` is called.
 */
export function createHintsPoll(
  testRunId: string,
  options: TestsPollOptions<TestRunHints> = {},
): Poll<TestRunHints> {
  const url = hintsUrl(testRunId);
  const read: PollReader<TestRunHints> =
    options.read ??
    ((etag) =>
      requestPayload(url, etag, isTestRunHints, {
        unreachable: UNREACHABLE_HINTS,
        unreadable: UNREADABLE_HINTS,
      }));

  return createPoll(read, options);
}
