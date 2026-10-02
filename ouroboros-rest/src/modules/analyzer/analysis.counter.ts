/**
 * The every-N-builds trigger — the head's *"every 50 builds"*, counted on farm job completion
 * (BV.1, [#510](https://github.com/NobuData/ouroboros/issues/510); the seam is AH.4's
 * `JobCompletions`, #252).
 *
 * A **build** here is what the corpus calls one: a job that finished `succeeded`, `failed` or
 * `retried`. A cancelled job never finished a build and does not count.
 *
 * Each such completion increments its repository's `analysis_schedules.build_counter` in one
 * statement that also tests the threshold and resets the counter when it is reached
 * (`AnalysisRepository.countBuild`), so a burst of completions fires exactly once per threshold —
 * never twice, never skipped. The build that fires it starts a run:
 *
 *   * **already running** — the guard refuses, and the run in flight covers these builds;
 *   * **anything else** (the engine down, the database unreachable) — the trigger is re-armed so
 *     the next build fires it again, rather than the fifty builds being forgotten.
 *
 * Like every `JobCompletions` subscriber this runs off the completing path and never affects it.
 */

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { ConflictError } from "../errors/error.envelope";
import { describeForLog } from "../errors/failure";
import { JobCompletions, type JobCompleted } from "../farm/dispatch/job.completions";
import { AnalysisOrchestrator } from "./analysis.orchestrator";
import { AnalysisRepository } from "./analysis.repository";

/** The completions that are builds. */
const BUILD_STATUSES: ReadonlySet<JobCompleted["status"]> = new Set([
  "succeeded",
  "failed",
  "retried",
]);

@Injectable()
export class AnalysisBuildCounter implements OnModuleInit, OnModuleDestroy {
  /** Where a fired trigger and its outcome are logged. */
  private readonly logger = new Logger(AnalysisBuildCounter.name);

  /** Stops listening. */
  private unsubscribe?: () => void;

  /**
   * @param completions - The farm's completion seam.
   * @param runs - The schedules' counters.
   * @param orchestrator - Where a fired trigger starts its run.
   */
  constructor(
    private readonly completions: JobCompletions,
    private readonly runs: AnalysisRepository,
    private readonly orchestrator: AnalysisOrchestrator,
  ) {}

  /** Start counting. */
  onModuleInit(): void {
    this.unsubscribe = this.completions.subscribe((event) => this.count(event));
  }

  /** Stop counting. */
  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  /**
   * Count one completion, and start a run when it reaches the threshold.
   *
   * @param event - The completion.
   * @returns When counted, and any run it fired has started or been refused.
   */
  async count(event: JobCompleted): Promise<void> {
    if (!BUILD_STATUSES.has(event.status)) {
      return;
    }

    const repoRef = await this.runs.jobRepo(event.organizationId, event.jobId);
    if (repoRef === undefined) {
      return;
    }

    const counted = await this.runs.countBuild(event.organizationId, repoRef);
    if (counted === undefined || !counted.fired) {
      return;
    }

    try {
      const run = await this.orchestrator.start({
        organizationId: event.organizationId,
        repoRef,
        trigger: "every_n_builds",
        scheduleId: counted.scheduleId,
      });
      this.logger.log(`Build ${event.jobId} fired every-N analysis ${run.id} of ${repoRef}.`);
    } catch (error) {
      if (error instanceof ConflictError) {
        this.logger.log(
          `Build ${event.jobId} fired an analysis of ${repoRef}; one is already running.`,
        );
        return;
      }

      this.logger.error(
        `Build ${event.jobId} fired an analysis of ${repoRef} that could not start; re-armed.`,
        describeForLog(error),
      );
      await this.runs.rearm(counted.scheduleId);
    }
  }
}
