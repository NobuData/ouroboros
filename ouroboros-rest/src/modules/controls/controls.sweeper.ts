/**
 * What makes control expiry periodic — AP.4
 * ([#306](https://github.com/NobuData/ouroboros/issues/306)), decision **R6**.
 *
 * The same shape as `estimation/estimation.sweeper.ts`, and for the reasons written out in
 * `backlog-sync/backlog-sync.scheduler.ts`: a jittered self-rescheduling timeout rather than
 * `@Interval`, a cycle that never overlaps itself, a failed cycle that costs a cycle rather than
 * the loop, and an unreferenced timer so a suite that built an application without listening
 * still exits.
 *
 * **What it is for.** V048 made every control carry an expiry, and left the sweep as *"a plain
 * statement — a scheduler is a deployment question"*. This loop answers that question for
 * this service. The listing, the fetch and the ack already sweep their own run before they
 * answer, so the console is never told `sent` about a control that has elapsed. What this loop
 * adds is the `run_control.expired` audit row for a run nobody is looking at, at the time it
 * expired rather than whenever somebody next opens the page.
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

import { AppConfigService } from "../config/config.service";
import { describeForLog } from "../errors/failure";
import { jittered } from "../scheduling/cadence";
import { ControlsService } from "./controls.service";

/** How the timer names itself in `SchedulerRegistry`. */
export const CONTROL_SWEEP_TIMEOUT = "run-control-expiry-sweep";

@Injectable()
export class ControlsSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  /** Where a sweep is reported. */
  private readonly logger = new Logger(ControlsSweeper.name);

  /** Set once the application is shutting down, so a sweep in flight books no further tick. */
  private stopped = false;

  /**
   * @param controls - The queue. This class owns *when* a sweep happens and nothing else.
   * @param config - The sweep cadence.
   * @param scheduler - Nest's registry, where every scheduled thing in this process lives.
   */
  constructor(
    private readonly controls: ControlsService,
    private readonly config: AppConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /** Start the loop once the application is up. The first delay is a full jittered interval. */
  onApplicationBootstrap(): void {
    this.schedule(this.interval());
  }

  /** Stop the loop, and clear a pending timer. */
  onApplicationShutdown(): void {
    this.stopped = true;

    if (this.scheduler.doesExist("timeout", CONTROL_SWEEP_TIMEOUT)) {
      this.scheduler.deleteTimeout(CONTROL_SWEEP_TIMEOUT);
    }
  }

  /**
   * Run one sweep and schedule the next, whatever the first did.
   *
   * Public so a test can drive a sweep without waiting for a timer.
   *
   * @returns When the sweep has settled and the next tick is booked.
   */
  async tick(): Promise<void> {
    if (this.scheduler.doesExist("timeout", CONTROL_SWEEP_TIMEOUT)) {
      this.scheduler.deleteTimeout(CONTROL_SWEEP_TIMEOUT);
    }

    try {
      const expired = await this.controls.sweep();

      if (expired > 0) {
        this.logger.log(`Control sweep: ${String(expired)} control(s) expired unanswered.`);
      }
    } catch (error) {
      // A sweep is lost, not the loop: the next listing, fetch or ack sweeps its own run anyway.
      this.logger.error("Control expiry sweep failed; retrying next tick.", describeForLog(error));
    }

    this.schedule(this.interval());
  }

  /**
   * The nominal delay, jittered.
   *
   * @returns Milliseconds.
   */
  private interval(): number {
    return jittered(this.config.runControlSweepSeconds * 1000);
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

    this.scheduler.addTimeout(CONTROL_SWEEP_TIMEOUT, timer);
  }
}
