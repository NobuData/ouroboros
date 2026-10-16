/**
 * The engine's two execution routes, as this service calls them (#160, ADR decision A).
 *
 * ```
 * POST /v0/runs/{run_id}/execute   (empty body)       → 202 {accepted, reason}
 * POST /v0/execution/claims        {workspace}        → 200 {claimed, run_id, reason}
 * ```
 *
 * Both are the run supervisor's: `execute` resubmits a run whose worker went quiet (the engine
 * starts it under a new epoch, which fences the old worker out), and `claims` asks the engine to
 * claim and open a workspace's next admissible queue item. Each answers at once — the work
 * happens in the engine's background — and each can decline without failing: no executor
 * registered, the run already executing in that process, nothing queued.
 */

import { z } from "zod";

import { ENGINE_API_VERSION } from "./engine.contract";

/**
 * The execute route for one run, relative to `OURO_ENGINE_URL`.
 *
 * @param runId - `runs.id`.
 * @returns `v0/runs/<run>/execute`.
 */
export function engineExecuteRunRoute(runId: string): string {
  return `${ENGINE_API_VERSION}/runs/${encodeURIComponent(runId)}/execute`;
}

/** The claim route, relative to `OURO_ENGINE_URL`. */
export const ENGINE_EXECUTION_CLAIMS_ROUTE = `${ENGINE_API_VERSION}/execution/claims`;

/** Whether the engine took a run to execute. */
export interface EngineExecuteAccepted {
  /** `true` when it scheduled the run's execution. */
  readonly accepted: boolean;
  /** Why not — `no_executor`, `already_running` — or `null` when accepted. */
  readonly reason: string | null;
}

/** Whether the engine claimed a workspace's queue item and opened a run from it. */
export interface EngineClaimOutcome {
  /** `true` when it opened (and is executing) a run. */
  readonly claimed: boolean;
  /** The run it opened, or `null`. */
  readonly runId: string | null;
  /** Why not — `no_executor`, `nothing_queued`, or this service's refusal code — or `null`. */
  readonly reason: string | null;
}

/** What a `202` from the execute route must be. */
export const executeAcceptedSchema = z
  .object({
    accepted: z.boolean(),
    reason: z.string().nullable(),
  })
  .transform((answer): EngineExecuteAccepted => ({
    accepted: answer.accepted,
    reason: answer.reason,
  }));

/** What a `200` from the claim route must be. */
export const claimOutcomeSchema = z
  .object({
    claimed: z.boolean(),
    run_id: z.string().nullable(),
    reason: z.string().nullable(),
  })
  .transform((answer): EngineClaimOutcome => ({
    claimed: answer.claimed,
    runId: answer.run_id,
    reason: answer.reason,
  }));
