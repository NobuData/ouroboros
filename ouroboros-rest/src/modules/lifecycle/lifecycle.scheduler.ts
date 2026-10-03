/**
 * When the purge runs: every `OURO_LIFECYCLE_PURGE_SWEEP_SECONDS` (an hour by default), jittered
 * ±25% like every loop here (BR.5, [#489](https://github.com/NobuData/ouroboros/issues/489)).
 *
 * The `ControlsSweeper` shape: a self-rescheduling, `unref()`'d timeout in Nest's
 * `SchedulerRegistry`, started on bootstrap and cleared on shutdown, with a public `tick()` a
 * test drives without waiting.
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
import { LifecyclePurge } from "./lifecycle.purge";

/** The timeout's name in the registry. */
export const LIFECYCLE_PURGE_TIMEOUT = "workspace-lifecycle-purge-sweep";

@Injectable()
export class LifecyclePurgeScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  /** Where a sweep is reported. */
  private readonly logger = new Logger(LifecyclePurgeScheduler.name);

  /** Set once the application is shutting down, so a sweep in flight books no further tick. */
  private stopped = false;

  /**
   * @param purge - What a sweep does. This class owns only *when*.
   * @param config - The cadence.
   * @param scheduler - Nest's registry.
   */
  constructor(
    private readonly purge: LifecyclePurge,
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

    if (this.scheduler.doesExist("timeout", LIFECYCLE_PURGE_TIMEOUT)) {
      this.scheduler.deleteTimeout(LIFECYCLE_PURGE_TIMEOUT);
    }
  }

  /**
   * Run one sweep and schedule the next, whatever the first did.
   *
   * @param now - The instant to judge against; the current time by default.
   * @returns When the sweep has settled and the next tick is booked.
   */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.scheduler.doesExist("timeout", LIFECYCLE_PURGE_TIMEOUT)) {
      this.scheduler.deleteTimeout(LIFECYCLE_PURGE_TIMEOUT);
    }

    try {
      const reports = await this.purge.sweep(now);

      if (reports.length > 0) {
        this.logger.log(`Workspace purge: ${String(reports.length)} workspace(s) purged.`);
      }
    } catch (error) {
      // A sweep is lost, not the loop: every due workspace is still due next tick.
      this.logger.error("Workspace purge sweep failed; retrying next tick.", describeForLog(error));
    }

    this.schedule(this.interval());
  }

  /**
   * The nominal delay, jittered.
   *
   * @returns Milliseconds.
   */
  private interval(): number {
    return jittered(this.config.lifecyclePurgeSweepSeconds * 1000);
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

    this.scheduler.addTimeout(LIFECYCLE_PURGE_TIMEOUT, timer);
  }
}
