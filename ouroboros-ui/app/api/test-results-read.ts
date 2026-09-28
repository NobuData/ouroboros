import "server-only";

/**
 * The test-results page's reads, as its poll routes answer them
 * ([#335](https://github.com/NobuData/ouroboros/issues/335); the attempt's page with
 * [#337](https://github.com/NobuData/ouroboros/issues/337)).
 *
 * `app/api/run-console.ts` is the same file for the run console: each route handler hands one of
 * these answers to `pollResponse`, and the browser's loops (`app/test-results/poll.ts`) read them
 * back. The cadence is the shared I.8 default ([#87](https://github.com/NobuData/ouroboros/issues/87))
 * — nothing here overrides it.
 */

import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import {
  type RerunAvailability,
  type TestRunPage,
  type TestRunTimeline,
  isTestRunId,
  testResults,
} from "@/app/api/test-results";
import type { PollAnswer } from "@/app/poll";
import { UNREACHABLE_GATE, UNREACHABLE_PAGE, UNREACHABLE_TIMELINE } from "@/app/test-results/poll";

/** The code a failed timeline read is answered with. */
export const TESTS_UNAVAILABLE_CODE = "test_results_unavailable";

/** The code a failed gate read is answered with. */
export const RERUN_GATE_UNAVAILABLE_CODE = "rerun_gate_unavailable";

/** The code a failed read of an attempt's page is answered with. */
export const TEST_RUN_PAGE_UNAVAILABLE_CODE = "test_run_page_unavailable";

/** What is said, before calling out, for a gate asked of something that is not a test run id. */
export const TEST_RUN_ID_INVALID = "That is not a test run id.";

/**
 * Read a run's timeline for the poll.
 *
 * @param runId The run's id.
 * @param read How to read it. Replaced in tests; production reads through the anonymous client,
 *   which forwards the browser's session.
 * @returns The poll's answer — never a throw.
 */
export async function readTimelineForPoll(
  runId: string,
  read: (runId: string, signal: AbortSignal) => Promise<TestRunTimeline> = (asked, signal) =>
    testResults.timeline(asked, anonymousApi(), signal),
): Promise<PollAnswer<TestRunTimeline>> {
  return readForPoll((signal) => read(runId, signal), UNREACHABLE_TIMELINE);
}

/**
 * Read an attempt's re-run gate for the poll.
 *
 * @param testRunId The attempt's id.
 * @param read How to read it. Replaced in tests.
 * @returns The poll's answer — never a throw. An id that is not a uuid is refused here rather
 *   than put in the service's path, for the reason `isRunId` gives.
 */
export async function readGateForPoll(
  testRunId: string,
  read: (testRunId: string, signal: AbortSignal) => Promise<RerunAvailability> = (
    asked,
    signal,
  ) => testResults.rerunAvailability(asked, anonymousApi(), signal),
): Promise<PollAnswer<RerunAvailability>> {
  if (!isTestRunId(testRunId)) {
    return { state: "failed", reason: TEST_RUN_ID_INVALID, pollAfterSeconds: null };
  }

  return readForPoll((signal) => read(testRunId, signal), UNREACHABLE_GATE);
}

/**
 * Read an attempt's page — its suites and their cases — for the poll
 * ([#337](https://github.com/NobuData/ouroboros/issues/337)).
 *
 * @param testRunId The attempt's id.
 * @param read How to read it. Replaced in tests.
 * @returns The poll's answer — never a throw. An id that is not a uuid is refused here rather
 *   than put in the service's path, for the reason `isRunId` gives.
 */
export async function readPageForPoll(
  testRunId: string,
  read: (testRunId: string, signal: AbortSignal) => Promise<TestRunPage> = (asked, signal) =>
    testResults.page(asked, anonymousApi(), signal),
): Promise<PollAnswer<TestRunPage>> {
  if (!isTestRunId(testRunId)) {
    return { state: "failed", reason: TEST_RUN_ID_INVALID, pollAfterSeconds: null };
  }

  return readForPoll((signal) => read(testRunId, signal), UNREACHABLE_PAGE);
}
