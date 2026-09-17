/**
 * What makes the re-estimation job nightly — a self-rescheduling timer booked at a jittered slot.
 *
 * AL.5 ([#281](https://github.com/NobuData/ouroboros/issues/281)). The shape of
 * `estimation/estimation.sweeper.ts` and the loops it names — a jittered timeout rather than a cron
 * decorator, a run that never overlaps itself, a failed run that costs a night rather than the loop,
 * and an unreferenced timer so a suite that built an application still exits — with one difference:
 * the delay is **to a wall-clock slot** (`OURO_REESTIMATION_HOUR_UTC`, jittered across
 * `OURO_REESTIMATION_JITTER_MINUTES`) rather than an interval, because *nightly* is a time of day.
 *
 * Every replica books the slot. V039's unique night is what lets exactly one of them run it — see
 * `reestimation.repository.ts`'s `startRun` — so no leader election is needed and no replica has to
 * be special.
 */

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { AppConfigService } from "../config/config.service";
import { describeForLog } from "../errors/failure";
import { nextNightlySlot, nightlyDelay, type NightlySlot } from "../scheduling/cadence";
import { ReestimationJob } from "./reestimation.job";

/** How the timer names itself in `SchedulerRegistry`. */
export const REESTIMATION_TIMEOUT = "backlog-reestimation-nightly";

@Injectable()
export class ReestimationScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  /** Where a night that could not run is reported. */
  private readonly logger = new Logger(ReestimationScheduler.name);

  /** Set once the application is shutting down — see `estimation.sweeper.ts`. */
  private stopped = false;

  /**
   * @param job - One night's work. This class owns *when*, and nothing about *what*.
   * @param config - The hour and the jitter window.
   * @param scheduler - Nest's registry, where every timer in this process is inspectable.
   */
  constructor(
    private readonly job: ReestimationJob,
    private readonly config: AppConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /**
   * The current instant — a method so a spec can pin it.
   *
   * @returns Now.
   */
  now(): Date {
    return new Date();
  }

  /** Book the first night once the application is up. Nothing runs at boot. */
  onApplicationBootstrap(): void {
    this.book();
  }

  /** Stop the loop and clear a pending timer. */
  onApplicationShutdown(): void {
    this.stopped = true;

    if (this.scheduler.doesExist("timeout", REESTIMATION_TIMEOUT)) {
      this.scheduler.deleteTimeout(REESTIMATION_TIMEOUT);
    }
  }

  /**
   * Run one night and book the next, whatever the first did.
   *
   * Public so a suite can drive a night without waiting for 02:00.
   *
   * @param slot - The night being run.
   * @returns When the run has settled and the next night is booked.
   */
  async tick(slot: NightlySlot): Promise<void> {
    if (this.scheduler.doesExist("timeout", REESTIMATION_TIMEOUT)) {
      this.scheduler.deleteTimeout(REESTIMATION_TIMEOUT);
    }

    try {
      await this.job.run(slot);
    } catch (error) {
      // The night could not even be claimed — the database is unreachable. A night is lost, not the
      // loop: a caught error that stopped rescheduling would leave a process that looks healthy
      // and never re-estimates again.
      this.logger.error(
        `Nightly re-estimation for ${slot.night} could not start; retrying tomorrow.`,
        describeForLog(error),
      );
    }

    this.book();
  }

  /** Book the next slot, jittered, unless the application is going away. */
  private book(): void {
    if (this.stopped) {
      return;
    }

    const now = this.now();
    const slot = nextNightlySlot(now, this.config.reestimationHourUtc);
    const timer = setTimeout(
      () => {
        void this.tick(slot);
      },
      nightlyDelay(now, slot, this.config.reestimationJitterMinutes),
    );

    // The loop must not be the reason a process stays alive.
    timer.unref();

    this.scheduler.addTimeout(REESTIMATION_TIMEOUT, timer);
  }
}
