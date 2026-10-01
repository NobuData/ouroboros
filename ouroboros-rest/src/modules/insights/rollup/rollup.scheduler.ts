/**
 * What makes the Insights rollup periodic (BI.2, [#433](https://github.com/NobuData/ouroboros/issues/433)).
 *
 * The shape of `estimation/estimation.sweeper.ts` — a jittered self-rescheduling timeout rather
 * than `@Interval`, a pass that never overlaps itself, a failed pass that costs a tick rather than
 * the loop, and an unreferenced timer so a suite that built an application still exits.
 *
 * **One loop does the hourly tail and the nightly consolidation.** Every tick re-fills today; the
 * first tick of a new UTC day finds yesterday unfilled and consolidates (`rollup.plan.ts`). There
 * is no second, nightly timer to drift out of step with the first, and a process that was down
 * across midnight consolidates on its first tick back instead of waiting a day.
 *
 * Every replica ticks; each day is filled under a per-(workspace, family) advisory lock and the
 * fill is idempotent (`rollup.repository.ts`), so no leader election is needed.
 *
 * **It logs only when something failed or a backfill moved.** A healthy deployment re-fills today
 * every hour, and a line per tick would be a log nobody reads by the second day.
 */

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { AppConfigService } from "../../config/config.service";
import { describeForLog } from "../../errors/failure";
import { jittered } from "../../scheduling/cadence";
import { RollupService, type RollupReport } from "./rollup.service";

/** How the timer names itself in `SchedulerRegistry`. */
export const ROLLUP_TIMEOUT = "insights-rollup-tick";

@Injectable()
export class RollupScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  /** Where a tick's failures and backfill progress are reported. */
  private readonly logger = new Logger(RollupScheduler.name);

  /** Set once the application is shutting down — see `estimation.sweeper.ts`. */
  private stopped = false;

  /** The pass in flight, so a second caller joins it rather than starting another. */
  private pass?: Promise<void>;

  /**
   * @param rollups - One pass. This class owns *when*, and nothing about *what*.
   * @param config - The cadence.
   * @param scheduler - Nest's registry, where every timer in this process is inspectable.
   */
  constructor(
    private readonly rollups: RollupService,
    private readonly config: AppConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /** Book the first tick once the application is up — a full jittered interval away. */
  onApplicationBootstrap(): void {
    this.schedule();
  }

  /** Stop the loop and clear a pending timer. */
  onApplicationShutdown(): void {
    this.stopped = true;

    if (this.scheduler.doesExist("timeout", ROLLUP_TIMEOUT)) {
      this.scheduler.deleteTimeout(ROLLUP_TIMEOUT);
    }
  }

  /**
   * Run one pass and book the next, whatever the first did. A call made while a pass is running
   * joins it.
   *
   * @returns When the pass has settled and the next tick is booked.
   */
  async tick(): Promise<void> {
    if (this.pass !== undefined) {
      await this.pass;
      return;
    }

    this.pass = this.run();

    try {
      await this.pass;
    } finally {
      this.pass = undefined;
    }
  }

  /**
   * One pass, and the next tick booked whatever it did.
   *
   * @returns When the pass has settled. Never rejects.
   */
  private async run(): Promise<void> {
    if (this.scheduler.doesExist("timeout", ROLLUP_TIMEOUT)) {
      this.scheduler.deleteTimeout(ROLLUP_TIMEOUT);
    }

    try {
      this.announce(await this.rollups.tick());
    } catch (error) {
      // The registry or the workspaces could not be read — the database is unreachable. A tick is
      // lost, not the loop.
      this.logger.error(
        "Insights rollup could not start; retrying next tick.",
        describeForLog(error),
      );
    }

    this.schedule();
  }

  /**
   * Say what a pass did, when it did anything worth saying.
   *
   * @param report - The pass.
   */
  private announce(report: RollupReport): void {
    const failed = report.outcomes.filter((outcome) => outcome.status === "failed");
    const backfilled = report.outcomes.reduce(
      (total, outcome) => total + outcome.backfilledDays,
      0,
    );

    for (const outcome of failed) {
      this.logger.error(
        `Insights rollup ${outcome.family} failed for workspace ${outcome.organizationId}: ` +
          `${outcome.error ?? "unknown error"}`,
      );
    }

    if (backfilled > 0) {
      this.logger.log(
        `Insights rollup (${report.today}): backfilled ${String(backfilled)} family-day(s) ` +
          `across ${String(new Set(report.outcomes.map((outcome) => outcome.organizationId)).size)} workspace(s).`,
      );
    }
  }

  /** Book the next tick, jittered, unless the application is going away. */
  private schedule(): void {
    if (this.stopped) {
      return;
    }

    const timer = setTimeout(
      () => {
        void this.tick();
      },
      jittered(this.config.insightsRollupIntervalSeconds * 1000),
    );

    // The loop must not be the reason a process stays alive.
    timer.unref();

    this.scheduler.addTimeout(ROLLUP_TIMEOUT, timer);
  }
}
