/**
 * What makes the live-run limits periodic — DI.4
 * ([#1312](https://github.com/NobuData/ouroboros/issues/1312)).
 *
 * The same shape as `controls.sweeper.ts`: a jittered self-rescheduling timeout, a cycle that
 * never overlaps itself, a failed cycle that costs a cycle rather than the loop, and an
 * unreferenced timer. Each cycle aborts, through the control queue, every live run past
 * `OURO_LIVE_RUN_WALL_CLOCK_MINUTES` or silent for `OURO_LIVE_RUN_NO_PROGRESS_MINUTES` —
 * `ControlsService.enforceLiveLimits` is the rule; this class only decides when it runs.
 *
 * **It logs only when it did something**, as every loop here does.
 */

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { describeForLog } from "../errors/failure";
import { jittered } from "../scheduling/cadence";
import { ControlsService } from "./controls.service";

/** How the timer names itself in `SchedulerRegistry`. */
export const LIVE_LIMITS_SWEEP_TIMEOUT = "live-run-limits-sweep";

/**
 * How often the limits are checked, in seconds — a minute. Both limits are measured in minutes,
 * so a run is aborted within about a minute of passing one.
 */
export const LIVE_LIMITS_SWEEP_SECONDS = 60;

@Injectable()
export class LiveLimitsSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  /** Where a cycle is reported. */
  private readonly logger = new Logger(LiveLimitsSweeper.name);

  /** Set once the application is shutting down, so a cycle in flight books no further tick. */
  private stopped = false;

  /**
   * @param controls - The queue, and the rule.
   * @param scheduler - Nest's registry, where every scheduled thing in this process lives.
   */
  constructor(
    private readonly controls: ControlsService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /** Start the loop once the application is up. The first delay is a full jittered interval. */
  onApplicationBootstrap(): void {
    this.schedule(this.interval());
  }

  /** Stop the loop, and clear a pending timer. */
  onApplicationShutdown(): void {
    this.stopped = true;

    if (this.scheduler.doesExist("timeout", LIVE_LIMITS_SWEEP_TIMEOUT)) {
      this.scheduler.deleteTimeout(LIVE_LIMITS_SWEEP_TIMEOUT);
    }
  }

  /**
   * Run one cycle and schedule the next, whatever the first did.
   *
   * Public so a test can drive a cycle without waiting for a timer.
   *
   * @returns When the cycle has settled and the next tick is booked.
   */
  async tick(): Promise<void> {
    if (this.scheduler.doesExist("timeout", LIVE_LIMITS_SWEEP_TIMEOUT)) {
      this.scheduler.deleteTimeout(LIVE_LIMITS_SWEEP_TIMEOUT);
    }

    try {
      const aborted = await this.controls.enforceLiveLimits();

      if (aborted > 0) {
        this.logger.log(`Live-run limits: ${String(aborted)} run(s) aborted past a limit.`);
      }
    } catch (error) {
      // A cycle is lost, not the loop: an overdue run is still overdue next minute.
      this.logger.error("Live-run limits sweep failed; retrying next tick.", describeForLog(error));
    }

    this.schedule(this.interval());
  }

  /**
   * The nominal delay, jittered.
   *
   * @returns Milliseconds.
   */
  private interval(): number {
    return jittered(LIVE_LIMITS_SWEEP_SECONDS * 1000);
  }

  /**
   * Book the next tick, unless the application is going away.
   *
   * @param delayMs - How long to wait.
   */
  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }

    const timer = setTimeout(() => {
      void this.tick();
    }, delayMs);

    timer.unref();

    this.scheduler.addTimeout(LIVE_LIMITS_SWEEP_TIMEOUT, timer);
  }
}
