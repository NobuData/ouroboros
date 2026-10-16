/**
 * A run's `building` status, kept honest by its build's completion (AJ.3,
 * [#265](https://github.com/NobuData/ouroboros/issues/265)).
 *
 * A build stage's submission reserves its job and moves the run to `building`
 * (`run-builds.service.ts`). This subscriber is the other half: when the reserved job completes,
 *
 * ```
 * retried                       → the reservation moves to the retry; the run stays building
 * succeeded · failed · canceled → a building run is coding again (the reservation stays, so the
 *                                 console still names the build that ran: built, build failed)
 * ```
 *
 * Like every `JobCompletions` subscriber it runs off the completing path and never affects it: a
 * failure here is logged, and the build is finished regardless.
 */

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { describeForLog } from "../errors/failure";
import { JobCompletions, type JobCompleted } from "../farm/dispatch/job.completions";
import { RunBuildsRepository } from "./run-builds.repository";

@Injectable()
export class RunBuildStatus implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RunBuildStatus.name);

  /** Stops listening. */
  private unsubscribe?: () => void;

  /**
   * @param completions - The farm's completion seam.
   * @param builds - The run's side of the linkage.
   */
  constructor(
    private readonly completions: JobCompletions,
    private readonly builds: RunBuildsRepository,
  ) {}

  /** Start listening. */
  onModuleInit(): void {
    this.unsubscribe = this.completions.subscribe((event) => this.completed(event));
  }

  /** Stop listening. */
  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  /**
   * One build completed: release the run that reserved it, if any did.
   *
   * @param event - The completion.
   */
  async completed(event: JobCompleted): Promise<void> {
    try {
      await this.builds.released(event.organizationId, event.jobId, event.status);
    } catch (error) {
      this.logger.error(
        `The run holding build ${event.jobId} was not released: ${describeForLog(error)}`,
      );
    }
  }
}
