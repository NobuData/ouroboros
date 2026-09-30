/**
 * What makes the staleness sweep nightly (BF.2,
 * [#411](https://github.com/NobuData/ouroboros/issues/411)).
 *
 * The shape of `flakes/flake-rescore.scheduler.ts`: a jittered self-rescheduling timeout booked at
 * `OURO_FACT_SWEEP_HOUR_UTC`, a pass that never overlaps itself, a failed pass that costs a night
 * rather than the loop, and an unreferenced timer so a suite that built an application still exits.
 *
 * Nothing runs at boot: the first pass is the next slot. Every replica books the slot; the pass is
 * idempotent — `flagStale` moves only a fact still `confirmed`, and `last_checked_at` never moves
 * backwards — so no leader election is needed.
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
import { nextNightlySlot, nightlyDelay } from "../scheduling/cadence";
import { FactSweepService } from "./facts.sweep";

/** How the timer names itself in `SchedulerRegistry`. */
export const FACT_SWEEP_TIMEOUT = "fact-staleness-sweep";

/** The window after the scheduled hour a night's pass may land in — one hour. */
export const FACT_SWEEP_JITTER_MINUTES = 60;

@Injectable()
export class FactSweepScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  /** Where a pass that could not start is reported. */
  private readonly logger = new Logger(FactSweepScheduler.name);

  /** Set once the application is shutting down. */
  private stopped = false;

  /** The pass in flight, so a second caller joins it rather than starting another. */
  private pass?: Promise<void>;

  /**
   * @param sweep - One night's work. This class owns *when*, and nothing about *what*.
   * @param config - The hour.
   * @param scheduler - Nest's registry.
   */
  constructor(
    private readonly sweep: FactSweepService,
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

    if (this.scheduler.doesExist("timeout", FACT_SWEEP_TIMEOUT)) {
      this.scheduler.deleteTimeout(FACT_SWEEP_TIMEOUT);
    }
  }

  /**
   * Run one night's pass and book the next, whatever the first did. A call made while a pass is
   * running joins it.
   *
   * @returns When the pass has settled and the next night is booked.
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
   * One pass, and the next night booked whatever it did.
   *
   * @returns When the pass has settled. Never rejects.
   */
  private async run(): Promise<void> {
    if (this.scheduler.doesExist("timeout", FACT_SWEEP_TIMEOUT)) {
      this.scheduler.deleteTimeout(FACT_SWEEP_TIMEOUT);
    }

    try {
      await this.sweep.sweepAll(this.now());
    } catch (error) {
      // The workspaces could not even be listed. A night is lost, not the loop.
      this.logger.error(
        "Nightly fact staleness sweep could not start; retrying tomorrow.",
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
    const slot = nextNightlySlot(now, this.config.factSweepHourUtc);
    const timer = setTimeout(
      () => {
        void this.tick();
      },
      nightlyDelay(now, slot, FACT_SWEEP_JITTER_MINUTES),
    );

    // The loop must not be the reason a process stays alive.
    timer.unref();

    this.scheduler.addTimeout(FACT_SWEEP_TIMEOUT, timer);
  }
}
