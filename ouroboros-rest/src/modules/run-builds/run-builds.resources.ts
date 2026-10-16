/**
 * What a run's build routes answer (AJ.3, [#265](https://github.com/NobuData/ouroboros/issues/265))
 * — the job's real lifecycle, its exit code and its ccache result, which the engine's build stage
 * reports as stage progress and its gate decides on.
 *
 * camelCase, ISO 8601 instants and `null` for what has not happened, like the farm's own
 * resources (`jobs.resources.ts`). A plain interface with a mapper, so a column added to
 * `build_jobs` never reaches the engine by accident.
 */

import type { BuildJob } from "../db/schema";
import type { CcacheStats } from "../farm/gateway/terminal";
import type { DispatchQueueState } from "../farm/dispatch/jobs.resources";
import { phaseOf, type JobPhase } from "../farm/dispatch/job.states";

/** A ccache result as a gate reads it: the counts, and the hit rate they make. */
export interface CcacheSummary {
  readonly hits: number;
  readonly misses: number;
  /** `hits / (hits + misses)`, as a percentage rounded to one decimal — mockup 08's `78.4`. */
  readonly hitRatePct: number;
}

/** One build of a run, followed to the latest attempt of its retry chain. */
export interface RunBuildResource {
  /** The attempt this answer describes — the latest of the chain. */
  readonly jobId: string;
  /** Its public name within the workspace — mockup 08's `#479`. */
  readonly number: number;
  /**
   * Where it is: `waiting` (queued, no runner), `offered`, `accepted`, `running`, or a terminal
   * `succeeded`, `failed` or `canceled`. Never `retried`: a retried attempt is followed to its
   * successor.
   */
  readonly phase: JobPhase;
  /**
   * For a `waiting` job, whether any runner could take it now — `queued_no_eligible_runner` is
   * what the engine's grace window watches. `null` in every other phase.
   */
  readonly queueState: Extract<
    DispatchQueueState,
    "queued_runner_available" | "queued_no_eligible_runner"
  > | null;
  /** The pool, by name. */
  readonly pool: string;
  /** The runner holding or last holding it; `null` while it waits. */
  readonly runnerName: string | null;
  /** The stage it builds for. */
  readonly stageKey: string | null;
  /** The stage attempt it builds for. */
  readonly stageAttempt: number | null;
  /** The command's exit code, once it has finished; `null` before and for a cancelled build. */
  readonly exitCode: number | null;
  /** The ccache result, or `null` — and null is not zero (decision B5): not measured. */
  readonly ccache: CcacheSummary | null;
  /** How many automatic retries the chain took before this attempt. */
  readonly retries: number;
  readonly queuedAt: string;
  readonly offeredAt: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

/** A build job, with the names its resource prints. */
export interface RunBuildView {
  readonly job: BuildJob;
  readonly poolName: string;
  readonly runnerName: string | null;
  /** How many attempts precede it in its retry chain. */
  readonly retries: number;
}

/**
 * A stored ccache summary, as a gate reads it.
 *
 * @param stats - `build_jobs.ccache_stats`: V040's shape, or null.
 * @returns The counts and hit rate, or `null` when nothing was measured.
 */
export function ccacheSummary(stats: unknown): CcacheSummary | null {
  if (stats === null || typeof stats !== "object") return null;

  const { hits, misses } = stats as Partial<CcacheStats>;
  if (typeof hits !== "number" || typeof misses !== "number" || hits + misses === 0) return null;

  return { hits, misses, hitRatePct: Math.round((hits / (hits + misses)) * 1000) / 10 };
}

/**
 * A run's build as the engine reads it.
 *
 * @param view - The latest attempt, with its pool's and runner's names.
 * @param queueState - Where a waiting job stands; ignored in every other phase.
 * @returns The resource.
 */
export function runBuildResource(
  view: RunBuildView,
  queueState: DispatchQueueState | null,
): RunBuildResource {
  const { job } = view;
  const phase = phaseOf(job);

  return {
    jobId: job.id,
    number: job.number,
    phase,
    queueState:
      phase === "waiting" && queueState !== null && queueState !== "offered" ? queueState : null,
    pool: view.poolName,
    runnerName: view.runnerName,
    stageKey: job.stage_key,
    stageAttempt: job.stage_attempt,
    exitCode: job.exit_code,
    ccache: ccacheSummary(job.ccache_stats),
    retries: view.retries,
    queuedAt: job.queued_at.toISOString(),
    offeredAt: job.offered_at?.toISOString() ?? null,
    startedAt: job.started_at?.toISOString() ?? null,
    finishedAt: job.finished_at?.toISOString() ?? null,
  };
}
