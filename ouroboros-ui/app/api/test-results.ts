/**
 * The test-results page's reads and its re-run write
 * ([#335](https://github.com/NobuData/ouroboros/issues/335), over AT.5's
 * [#333](https://github.com/NobuData/ouroboros/issues/333) and AT.4's
 * [#332](https://github.com/NobuData/ouroboros/issues/332)).
 *
 * ```
 * GET  /api/v1/runs/{id}/test-runs      the attempts, each with its strip — the page's frame
 * GET  /api/v1/test-runs/{id}/rerun     whether a re-run could be placed now, and each scope's N
 * POST /api/v1/test-runs/{id}/rerun     Re-run failed (N) / Re-run full suite
 * ```
 *
 * The shape every other module under `app/api/` keeps: the generated client does the transport,
 * `unwrap` turns a non-2xx into an `ApiError`, and a caller that already holds a client — a poll
 * route's anonymous one — passes it in.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** A run's attempts, each with its strip, and the next step. */
export type TestRunTimeline = components["schemas"]["TestRunTimeline"];

/** One attempt — Build 1 · 2 · 3. */
export type TestAttempt = components["schemas"]["TestAttempt"];

/** The five stat cards of one attempt. */
export type TestStrip = components["schemas"]["TestStrip"];

/** The run a timeline belongs to. */
export type TestTimelineRun = components["schemas"]["TestTimelineRun"];

/** Whether a re-run of an attempt could be placed now. */
export type RerunAvailability = components["schemas"]["RerunAvailability"];

/** `runner_available`, `no_eligible_runner`, `pool_disabled` or `no_source_build`. */
export type RerunReadiness = RerunAvailability["readiness"];

/** What a re-run answers: the queued build and its honest queue state. */
export type Rerun = components["schemas"]["Rerun"];

/** `failed` — the failed set — or `full`. */
export type RerunScope = Rerun["scope"];

/** A test run's id: `test_runs.id`, a uuid (V051). */
const TEST_RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a value can be a test run's id — checked by every hop that puts one in a path itself,
 * for the reason `isRunId` gives.
 *
 * @param value What arrived.
 * @returns `true` for a uuid.
 */
export function isTestRunId(value: unknown): value is string {
  return typeof value === "string" && TEST_RUN_ID.test(value);
}

export const testResults = {
  /**
   * Read a run's attempts timeline.
   *
   * @param runId The run's id.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @param signal Aborts the read — the poll route's timeout.
   * @returns The timeline, oldest attempt first.
   * @throws ApiError `404 run_not_found` for a run that is not this workspace's.
   */
  async timeline(
    runId: string,
    client: ApiClient = api(),
    signal?: AbortSignal,
  ): Promise<TestRunTimeline> {
    return unwrap(
      await client.GET("/api/v1/runs/{id}/test-runs", {
        params: { path: { id: runId } },
        signal,
      }),
    );
  },

  /**
   * Read whether a re-run of an attempt could be placed now.
   *
   * @param testRunId The attempt's id.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @param signal Aborts the read — the poll route's timeout.
   * @returns The readiness, the pool, and each scope's case count.
   * @throws ApiError `404 test_run_not_found` for an attempt that is not this workspace's.
   */
  async rerunAvailability(
    testRunId: string,
    client: ApiClient = api(),
    signal?: AbortSignal,
  ): Promise<RerunAvailability> {
    return unwrap(
      await client.GET("/api/v1/test-runs/{id}/rerun", {
        params: { path: { id: testRunId } },
        signal,
      }),
    );
  },

  /**
   * Queue a re-run of an attempt's failed set or its full suite.
   *
   * @param testRunId The attempt's id.
   * @param scope `failed` or `full`.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @returns The queued build and its queue state — never *started*.
   * @throws ApiError `403` for a viewer, `409 rerun_nothing_selected` or
   *   `409 rerun_source_missing`, `404 test_run_not_found`.
   */
  async rerun(testRunId: string, scope: RerunScope, client: ApiClient = api()): Promise<Rerun> {
    return unwrap(
      await client.POST("/api/v1/test-runs/{id}/rerun", {
        params: { path: { id: testRunId } },
        body: { scope },
      }),
    );
  },
};
