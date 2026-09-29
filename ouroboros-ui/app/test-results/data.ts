import "server-only";

/**
 * The test-results page's first read, on the server
 * ([#335](https://github.com/NobuData/ouroboros/issues/335)).
 *
 * What the page paints before the browser's polls have answered — `app/runs/data.ts`'s three
 * outcomes, for the same reasons: a timeline, a run that does not exist *for this workspace* (the
 * route's `notFound()`), and a failure the page draws as a banner while the poll keeps asking.
 *
 * Four reads ride along, each **best-effort**, because neither is the page's reason to exist:
 *
 * - **The run console's snapshot, for the tracker link, the commit links and the stages.** The
 *   timeline names the issue by number and each attempt's commit by sha; the repository they live
 *   in is the console's (`head.repository`), and `trackerUrl` and `commitSource` build from it
 *   exactly as the run console does. Unreadable, the headline and the shas
 *   ([#336](https://github.com/NobuData/ouroboros/issues/336)) are plain text rather than guessed
 *   links. Its stages say whether the run's workflow has a test stage at all
 *   ([#342](https://github.com/NobuData/ouroboros/issues/342)); unreadable, that is unknown, and
 *   the page never reports unknown as absent. Their attempts say which attempt a correction round
 *   would open ([#340](https://github.com/NobuData/ouroboros/issues/340)); unreadable, Mark &
 *   Route's action names no attempt rather than guessing one.
 * - **The selected attempt's re-run gate**, so the buttons can be honest on first paint. Unreadable,
 *   they say they are checking, and the gate's poll answers within one interval.
 * - **The selected attempt's page** ([#337](https://github.com/NobuData/ouroboros/issues/337)),
 *   so the suites card is drawn on first paint. Unreadable, the card says it is reading, and the
 *   page's poll answers within one interval.
 * - **The run's pull request** ([#363](https://github.com/NobuData/ouroboros/issues/363)), so the
 *   head can link to its verification page. The timeline names no PR, so it is looked up by run;
 *   unreadable, or for a run that opened none, the head draws no link.
 */

import { isApiError } from "@/app/api/errors";
import type { PullRequestRef } from "@/app/api/pull-requests";
import { runs } from "@/app/api/runs";
import {
  type RerunAvailability,
  type TestRunPage,
  type TestRunTimeline,
  testResults,
} from "@/app/api/test-results";
import { runPullRequests } from "@/app/prs/data";
import { type CommitSource, commitSource } from "@/app/runs/cards";
import { TEST_STAGE_KEY } from "@/app/runs/stepper";
import { trackerUrl } from "@/app/runs/view";

import { type StageAttempt, nextAttemptOf } from "./mark-route";
import { selectedAttempt } from "./view";

/** What the page's first read found. */
export interface TestsFirstRead {
  readonly timeline: TestRunTimeline;
  /** The ticket on its tracker, or `null`. */
  readonly trackerUrl: string | null;
  /** Where the run's commits live, or `null` — the timeline's shas are then plain text. */
  readonly commitSource: CommitSource | null;
  /** The selected attempt's gate, or `null` when there is no attempt or it could not be read. */
  readonly gate: RerunAvailability | null;
  /** The selected attempt's page, or `null` when there is no attempt or it could not be read. */
  readonly page: TestRunPage | null;
  /** The run's pull request, or `null` when it opened none or it could not be looked up. */
  readonly pullRequest: PullRequestRef | null;
  /** Whether the run's stages include the test stage, or `null` when that is not known. */
  readonly hasTestStage: boolean | null;
  /** The attempt a correction round would open, or `null` when the stages do not say. */
  readonly nextAttempt: number | null;
  /** When this read was made, in epoch milliseconds — the ingest-lag banner's first clock. */
  readonly readAt: number;
}

/** What the run console's snapshot is read for. */
export interface RunContext {
  /** The repository the run's issue and commits live in. */
  readonly repository: Parameters<typeof trackerUrl>[0];
  /** The DSL node id of each of the run's stages. */
  readonly stageKeys: readonly string[];
  /** Each stage's status, current attempt and when that attempt started. Empty when absent. */
  readonly stages?: readonly StageAttempt[];
}

/** What the first read found. */
export type TestsReading =
  | { readonly state: "found"; readonly value: TestsFirstRead }
  | { readonly state: "missing" }
  | { readonly state: "failed"; readonly reason: string };

/** How the reads are made. Replaced in tests. */
export interface TestsReaders {
  readonly timeline: (runId: string) => Promise<TestRunTimeline>;
  readonly context: (runId: string) => Promise<RunContext>;
  readonly gate: (testRunId: string) => Promise<RerunAvailability>;
  readonly page: (testRunId: string) => Promise<TestRunPage>;
  readonly pullRequest: (runId: string) => Promise<PullRequestRef | null>;
}

/** The production readers, over the request-scoped client. */
const READERS: TestsReaders = {
  timeline: (runId) => testResults.timeline(runId),
  context: async (runId) => {
    const snapshot = await runs.console(runId);

    return {
      repository: snapshot.head.repository,
      stageKeys: snapshot.timeline.stages.map((stage) => stage.stageKey),
      stages: snapshot.timeline.stages.map((stage) => ({
        status: stage.status,
        attempt: stage.attempt,
        startedAt:
          stage.attempts.find((each) => each.attempt === stage.attempt)?.startedAt ?? null,
      })),
    };
  },
  gate: (testRunId) => testResults.rerunAvailability(testRunId),
  page: (testRunId) => testResults.page(testRunId),
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
 * Whether a run's workflow has a test stage, as far as its stages say.
 *
 * @param context The run's context, or `null` when it could not be read.
 * @returns `true` or `false` once the run has reported its stages; `null` when the context could
 *   not be read or the run has reported no stage yet — a run that has named no stage has not
 *   said it lacks one.
 */
export function hasTestStage(context: RunContext | null): boolean | null {
  if (context === null || context.stageKeys.length === 0) return null;

  return context.stageKeys.includes(TEST_STAGE_KEY);
}

/**
 * Read one run's test results for the page.
 *
 * @param runId The run's id, from the URL.
 * @param attemptSeq The attempt `?attempt=` asked for, or `null` for the latest.
 * @param readers How to read. Replaced in tests.
 * @param now The clock, in epoch milliseconds. Replaced in tests.
 * @returns The reading. An error that is not the API's own is rethrown.
 */
export async function readTests(
  runId: string,
  attemptSeq: number | null,
  readers: TestsReaders = READERS,
  now: () => number = Date.now,
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
  const [context, gate, page, pullRequest] = await Promise.all([
    optional(readers.context(runId)),
    attempt === null ? Promise.resolve(null) : optional(readers.gate(attempt.id)),
    attempt === null ? Promise.resolve(null) : optional(readers.page(attempt.id)),
    optional(readers.pullRequest(runId)),
  ]);

  return {
    state: "found",
    value: {
      timeline,
      trackerUrl:
        context === null ? null : trackerUrl(context.repository, timeline.run.issueNumber),
      commitSource: context === null ? null : commitSource(context.repository),
      gate,
      page,
      pullRequest,
      hasTestStage: hasTestStage(context),
      nextAttempt: nextAttemptOf(context?.stages ?? null),
      readAt: now(),
    },
  };
}
