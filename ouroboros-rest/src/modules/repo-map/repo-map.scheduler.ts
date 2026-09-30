/**
 * What makes the repo-map generator nightly (BF.6,
 * [#415](https://github.com/NobuData/ouroboros/issues/415)).
 *
 * The shape of `facts/facts.scheduler.ts`: a jittered self-rescheduling timeout booked at
 * `OURO_REPO_MAP_HOUR_UTC`, a pass that never overlaps itself, a failed pass that costs a night
 * rather than the loop, and an unreferenced timer so a suite that built an application still exits.
 *
 * Nothing runs at boot: the first pass is the next slot. Every replica books the slot; the pass is
 * idempotent — an unchanged map publishes nothing, and a concurrent publish of the same change is
 * refused by V069's dense version numbering — so no leader election is needed.
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
import { RepoMapService } from "./repo-map.service";

/** How the timer names itself in `SchedulerRegistry`. */
export const REPO_MAP_TIMEOUT = "repo-map-generator";

/** The window after the scheduled hour a night's pass may land in — one hour. */
export const REPO_MAP_JITTER_MINUTES = 60;

@Injectable()
export class RepoMapScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  /** Where a pass that could not start is reported. */
  private readonly logger = new Logger(RepoMapScheduler.name);

  /** Set once the application is shutting down. */
  private stopped = false;

  /** The pass in flight, so a second caller joins it rather than starting another. */
  private pass?: Promise<void>;

  /**
   * @param generator - One night's work. This class owns *when*, and nothing about *what*.
   * @param config - The hour.
   * @param scheduler - Nest's registry.
   */
  constructor(
    private readonly generator: RepoMapService,
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

    if (this.scheduler.doesExist("timeout", REPO_MAP_TIMEOUT)) {
      this.scheduler.deleteTimeout(REPO_MAP_TIMEOUT);
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
    if (this.scheduler.doesExist("timeout", REPO_MAP_TIMEOUT)) {
      this.scheduler.deleteTimeout(REPO_MAP_TIMEOUT);
    }

    try {
      await this.generator.generateAll(this.now());
    } catch (error) {
      // The repositories could not even be listed. A night is lost, not the loop.
      this.logger.error(
        "Nightly repo-map generation could not start; retrying tomorrow.",
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
    const slot = nextNightlySlot(now, this.config.repoMapHourUtc);
    const timer = setTimeout(
      () => {
        void this.tick();
      },
      nightlyDelay(now, slot, REPO_MAP_JITTER_MINUTES),
    );

    // The loop must not be the reason a process stays alive.
    timer.unref();

    this.scheduler.addTimeout(REPO_MAP_TIMEOUT, timer);
  }
}
