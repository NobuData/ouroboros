/**
 * The test-results page's reads and its writes
 * ([#335](https://github.com/NobuData/ouroboros/issues/335), over AT.5's
 * [#333](https://github.com/NobuData/ouroboros/issues/333) and AT.4's
 * [#332](https://github.com/NobuData/ouroboros/issues/332)).
 *
 * ```
 * GET  /api/v1/runs/{id}/test-runs      the attempts, each with its strip — the page's frame
 * GET  /api/v1/test-runs/{id}           one attempt's page — its suites and their cases (#337)
 * GET  /api/v1/test-runs/{id}/hints     each failing case's heuristic triage hint (#339)
 * GET  /api/v1/test-runs/{id}/cases/{caseId}/failure   one case's failure payload (#339)
 * GET  /api/v1/test-runs/{id}/rerun     whether a re-run could be placed now, and each scope's N
 * POST /api/v1/test-runs/{id}/rerun     Re-run failed (N) / Re-run full suite
 * GET  /api/v1/artifacts/{id}           one artifact's file — streamed by `artifact-file.ts` (#341)
 * POST /api/v1/test-runs/{id}/cases/{caseId}/classify   Mark & Route's decision, routed (#340)
 * POST /api/v1/test-runs/{id}/waivers   Waive & annotate PR — the waiver half (#340)
 * PUT  /api/v1/runs/{id}/pr-intents     Mark & Route's two PR toggles, on their own (#340)
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

/** One attempt's page payload — the suites card reads its `suites` (#337). */
export type TestRunPage = components["schemas"]["TestRunPage"];

/** One thing the parser could not read and did not refuse the report over (#329) — the banner's. */
export type TestParseWarning = components["schemas"]["TestParseWarning"];

/** One suite on one platform — a row of the suites card. */
export type TestSuiteResult = components["schemas"]["TestSuiteResult"];

/** One case of a suite, with its retries — a row of the case drill. */
export type TestCaseResult = components["schemas"]["TestCaseResult"];

/** One artifact of an attempt — a live file, or the tombstone the retention sweep left (#341). */
export type TestArtifact = components["schemas"]["TestArtifact"];

/** An attempt's coverage — `87.4% (+0.6%)`, the delta absent when there is no earlier one. */
export type TestCoverage = components["schemas"]["TestCoverage"];

/** One case's failure payload — its path, its message and its log excerpt (#339). */
export type TestCaseFailureDetail = components["schemas"]["TestCaseFailureDetail"];

/**
 * An attempt's triage hints, one entry per failing case (#339, over AT.4's #332).
 *
 * Read off the read itself rather than `components`: the client types a response without the
 * fields the contract fixes at `null` — a heuristic hint's `confidence` — so this is the shape
 * {@link testResults.hints} answers with.
 */
export type TestRunHints = Awaited<ReturnType<typeof testResults.hints>>;

/** One failing case's hint, every rule's verdict, and the answer in `/v0/triage`'s shape. */
export type CaseHint = TestRunHints["cases"][number];

/** A heuristic hint — a class, the rule that picked it, and no confidence. */
export type TriageHint = NonNullable<CaseHint["hint"]>;

/** Whether a re-run of an attempt could be placed now. */
export type RerunAvailability = components["schemas"]["RerunAvailability"];

/** `runner_available`, `no_eligible_runner`, `pool_disabled` or `no_source_build`. */
export type RerunReadiness = RerunAvailability["readiness"];

/** What a re-run answers: the queued build and its honest queue state. */
export type Rerun = components["schemas"]["Rerun"];

/** `failed` — the failed set — or `full`. */
export type RerunScope = Rerun["scope"];

/** One recorded decision about a failing case, with its routing receipt (#340, over #332). */
export type Classification = components["schemas"]["Classification"];

/** `product_bug`, `test_update`, `flake_retry` or `infra_rig` — the Mark & Route card's radios. */
export type FailureClass = Classification["class"];

/** What a classification routed: the control, the build or the runner flag it dispatched. */
export type ClassificationReceipt = components["schemas"]["ClassificationReceipt"];

/** What classifying answers: the recorded decision, and what routing did — or could not do. */
export type ClassifyResult = components["schemas"]["ClassifyResult"];

/** What routing did, including what it skipped and why. */
export type TriageRouting = components["schemas"]["TriageRouting"];

/** What Mark & Route sends to classify a case. */
export type ClassifyRequest = components["schemas"]["ClassifyCaseRequest"];

/** A recorded waiver — its author, its reason and the cases it names. */
export type Waiver = components["schemas"]["Waiver"];

/** What *Waive & annotate PR* sends. */
export type WaiveRequest = components["schemas"]["WaiveRequest"];

/** The run's two PR toggles as stored. */
export type RunPrIntents = components["schemas"]["RunPrIntents"];

/** The toggles to set — one, or both. */
export type RunPrIntentsRequest = components["schemas"]["RunPrIntentsRequest"];

/** The dashed *Next* card's projection — the stored toggles, and whether a gate holds the PR. */
export type TestNextStep = components["schemas"]["TestNextStep"];

/** A test run's id — and an artifact's: `test_runs.id` (V051), `test_artifacts.id` (V055), uuids. */
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

/**
 * Whether a value can be an artifact's id — `test_artifacts.id`, a uuid (V055). Checked by every
 * hop that puts one in a path itself, for the reason `isRunId` gives.
 *
 * @param value What arrived.
 * @returns `true` for a uuid.
 */
export function isArtifactId(value: unknown): value is string {
  return typeof value === "string" && TEST_RUN_ID.test(value);
}

/**
 * Whether a value can be a test case's id — `test_cases.id`, a uuid (V051). Checked by every hop
 * that puts one in a path itself, for the reason `isRunId` gives.
 *
 * @param value What arrived.
 * @returns `true` for a uuid.
 */
export function isTestCaseId(value: unknown): value is string {
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
   * Read one attempt's page — its suites, each with its counts and cases.
   *
   * @param testRunId The attempt's id.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @param signal Aborts the read — the poll route's timeout.
   * @returns The attempt's page payload.
   * @throws ApiError `404 test_run_not_found` for an attempt that is not this workspace's.
   */
  async page(
    testRunId: string,
    client: ApiClient = api(),
    signal?: AbortSignal,
  ): Promise<TestRunPage> {
    return unwrap(
      await client.GET("/api/v1/test-runs/{id}", {
        params: { path: { id: testRunId } },
        signal,
      }),
    );
  },

  /**
   * Read one case's failure payload ([#339](https://github.com/NobuData/ouroboros/issues/339)).
   *
   * @param testRunId The attempt's id.
   * @param caseId The case's id in that attempt.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @param signal Aborts the read — the poll route's timeout.
   * @returns The case's path, message and log excerpt.
   * @throws ApiError `404` for an attempt or a case that is not this workspace's, or a case that
   *   has no failure.
   */
  async failure(
    testRunId: string,
    caseId: string,
    client: ApiClient = api(),
    signal?: AbortSignal,
  ): Promise<TestCaseFailureDetail> {
    return unwrap(
      await client.GET("/api/v1/test-runs/{id}/cases/{caseId}/failure", {
        params: { path: { id: testRunId, caseId } },
        signal,
      }),
    );
  },

  /**
   * Read an attempt's triage hints ([#339](https://github.com/NobuData/ouroboros/issues/339)).
   *
   * @param testRunId The attempt's id.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @param signal Aborts the read — the poll route's timeout.
   * @returns One entry per failing case: its hint, or `null` when no rule fired.
   * @throws ApiError `404 test_run_not_found` for an attempt that is not this workspace's.
   */
  async hints(testRunId: string, client: ApiClient = api(), signal?: AbortSignal) {
    return unwrap(
      await client.GET("/api/v1/test-runs/{id}/hints", {
        params: { path: { id: testRunId } },
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

  /**
   * Classify a failing case, and route the decision
   * ([#340](https://github.com/NobuData/ouroboros/issues/340)).
   *
   * @param testRunId The attempt's id.
   * @param caseId The case's id in that attempt.
   * @param request The class, the correction note and the toggles.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @returns The recorded decision with its receipt, and what routing did.
   * @throws ApiError `403` for a viewer, `422 classification_note_required`,
   *   `409 test_case_not_failing`, `404` for an attempt or a case that is not this workspace's.
   */
  async classify(
    testRunId: string,
    caseId: string,
    request: ClassifyRequest,
    client: ApiClient = api(),
  ): Promise<ClassifyResult> {
    return unwrap(
      await client.POST("/api/v1/test-runs/{id}/cases/{caseId}/classify", {
        params: { path: { id: testRunId, caseId } },
        body: request,
      }),
    );
  },

  /**
   * Record a waiver ([#340](https://github.com/NobuData/ouroboros/issues/340)).
   *
   * @param testRunId The attempt's id.
   * @param request The reason, and the cases waived.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @returns The waiver — its author, and that no PR annotation was attempted.
   * @throws ApiError `403` for anyone but an owner or an admin, `422` for a blank reason or a
   *   case that is not in the attempt, `404 test_run_not_found`.
   */
  async waive(
    testRunId: string,
    request: WaiveRequest,
    client: ApiClient = api(),
  ): Promise<Waiver> {
    return unwrap(
      await client.POST("/api/v1/test-runs/{id}/waivers", {
        params: { path: { id: testRunId } },
        body: request,
      }),
    );
  },

  /**
   * Set the run's PR toggles ([#340](https://github.com/NobuData/ouroboros/issues/340)).
   *
   * @param runId The run's id.
   * @param request The toggles to set; an absent one keeps its stored value.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @returns Both toggles as stored.
   * @throws ApiError `403` for a viewer, `422 pr_intents_empty`, `404 run_not_found`.
   */
  async setIntents(
    runId: string,
    request: RunPrIntentsRequest,
    client: ApiClient = api(),
  ): Promise<RunPrIntents> {
    return unwrap(
      await client.PUT("/api/v1/runs/{id}/pr-intents", {
        params: { path: { id: runId } },
        body: request,
      }),
    );
  },
};
