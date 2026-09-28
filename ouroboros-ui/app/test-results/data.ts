import "server-only";

/**
 * The test-results page's first read, on the server
 * ([#335](https://github.com/NobuData/ouroboros/issues/335)).
 *
 * What the page paints before the browser's polls have answered — `app/runs/data.ts`'s three
 * outcomes, for the same reasons: a timeline, a run that does not exist *for this workspace* (the
 * route's `notFound()`), and a failure the page draws as a banner while the poll keeps asking.
 *
 * Two reads ride along, each **best-effort**, because neither is the page's reason to exist:
 *
 * - **The run console's snapshot, for the tracker link.** The timeline names the issue by number;
 *   the repository it lives in is the console's (`head.repository`), and `trackerUrl` builds the
 *   link from the two exactly as the run console's headline does. Unreadable, the headline is
 *   plain text rather than a guessed link.
 * - **The selected attempt's re-run gate**, so the buttons can be honest on first paint. Unreadable,
 *   they say they are checking, and the gate's poll answers within one interval.
 * - **The run's pull request** ([#363](https://github.com/NobuData/ouroboros/issues/363)), so the
 *   head can link to its verification page. The timeline names no PR, so it is looked up by run;
 *   unreadable, or for a run that opened none, the head draws no link.
 */

import { isApiError } from "@/app/api/errors";
import type { PullRequestRef } from "@/app/api/pull-requests";
import { runs } from "@/app/api/runs";
import {
  type RerunAvailability,
  type TestRunTimeline,
  testResults,
} from "@/app/api/test-results";
import { runPullRequests } from "@/app/prs/data";
import { trackerUrl } from "@/app/runs/view";

import { selectedAttempt } from "./view";

/** What the page's first read found. */
export interface TestsFirstRead {
  readonly timeline: TestRunTimeline;
  /** The ticket on its tracker, or `null`. */
  readonly trackerUrl: string | null;
  /** The selected attempt's gate, or `null` when there is no attempt or it could not be read. */
  readonly gate: RerunAvailability | null;
  /** The run's pull request, or `null` when it opened none or it could not be looked up. */
  readonly pullRequest: PullRequestRef | null;
}

/** What the first read found. */
export type TestsReading =
  | { readonly state: "found"; readonly value: TestsFirstRead }
  | { readonly state: "missing" }
  | { readonly state: "failed"; readonly reason: string };

/** How the three reads are made. Replaced in tests. */
export interface TestsReaders {
  readonly timeline: (runId: string) => Promise<TestRunTimeline>;
  readonly repository: (runId: string) => Promise<Parameters<typeof trackerUrl>[0]>;
  readonly gate: (testRunId: string) => Promise<RerunAvailability>;
  readonly pullRequest: (runId: string) => Promise<PullRequestRef | null>;
}

/** The production readers, over the request-scoped client. */
const READERS: TestsReaders = {
  timeline: (runId) => testResults.timeline(runId),
  repository: async (runId) => (await runs.console(runId)).head.repository,
  gate: (testRunId) => testResults.rerunAvailability(testRunId),
  pullRequest: async (runId) => (await runPullRequests([runId])).get(runId) ?? null,
};

/**
 * A best-effort read: its value, or `null` for a refusal the API answered.
 *
 * @param read The read.
 * @returns The value, or `null`. An error that is not the API's own is rethrown — a bug is not a
 *   missing link.
 * @typeParam T What it reads.
 */
async function optional<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (!isApiError(error)) throw error;

    return null;
  }
}

/**
 * Read one run's test results for the page.
 *
 * @param runId The run's id, from the URL.
 * @param attemptSeq The attempt `?attempt=` asked for, or `null` for the latest.
 * @param readers How to read. Replaced in tests.
 * @returns The reading. An error that is not the API's own is rethrown.
 */
export async function readTests(
  runId: string,
  attemptSeq: number | null,
  readers: TestsReaders = READERS,
): Promise<TestsReading> {
  let timeline: TestRunTimeline;

  try {
    timeline = await readers.timeline(runId);
  } catch (error) {
    if (!isApiError(error)) throw error;
    if (error.status === 404 || error.status === 400) return { state: "missing" };

    return { state: "failed", reason: error.message };
  }

  const attempt = selectedAttempt(timeline.attempts, attemptSeq);
  const [repository, gate, pullRequest] = await Promise.all([
    optional(readers.repository(runId)),
    attempt === null ? Promise.resolve(null) : optional(readers.gate(attempt.id)),
    optional(readers.pullRequest(runId)),
  ]);

  return {
    state: "found",
    value: {
      timeline,
      trackerUrl: repository === null ? null : trackerUrl(repository, timeline.run.issueNumber),
      gate,
      pullRequest,
    },
  };
}
