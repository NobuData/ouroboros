/**
 * What makes the flake re-scorer nightly — a self-rescheduling timer booked at a jittered slot
 * (AT.3, [#331](https://github.com/NobuData/ouroboros/issues/331)).
 *
 * The shape of `planning/reestimation.scheduler.ts`: a jittered timeout rather than a cron
 * decorator, a pass that never overlaps itself, a failed pass that costs a night rather than the
 * loop, and an unreferenced timer so a suite that built an application still exits. The slot is
 * `OURO_FLAKE_RESCORE_HOUR_UTC`, jittered across {@link FLAKE_RESCORE_JITTER_MINUTES} after it, so a
 * fleet of self-hosted installations — and the tenants of one multi-tenant deployment's replicas —
 * do not all hit their databases in the same second.
 *
 * Nothing runs at boot: the first pass is the next slot. Every replica books the slot; the pass is
 * idempotent (see `flake-scorer.service.ts`), so no leader election is needed.
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
import { FlakeScorerService, type RescoreReport } from "./flake-scorer.service";

/** How the timer names itself in `SchedulerRegistry`. */
export const FLAKE_RESCORE_TIMEOUT = "flake-rescore-nightly";

/** The window after the scheduled hour a night's pass may land in — one hour. */
export const FLAKE_RESCORE_JITTER_MINUTES = 60;

@Injectable()
export class FlakeRescoreScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  /** Where a night's outcome is reported. */
  private readonly logger = new Logger(FlakeRescoreScheduler.name);

  /** Set once the application is shutting down — see `estimation.sweeper.ts`. */
  private stopped = false;

  /** The pass in flight, so a second caller joins it rather than starting another. */
  private pass?: Promise<void>;

  /**
   * @param scorer - One night's work. This class owns *when*, and nothing about *what*.
   * @param config - The hour.
   * @param scheduler - Nest's registry, where every timer in this process is inspectable.
   */
  constructor(
    private readonly scorer: FlakeScorerService,
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

    if (this.scheduler.doesExist("timeout", FLAKE_RESCORE_TIMEOUT)) {
      this.scheduler.deleteTimeout(FLAKE_RESCORE_TIMEOUT);
    }
  }

  /**
   * Run one night's pass and book the next, whatever the first did.
   *
   * Public so a suite can drive a night without waiting for 03:00. A call made while a pass is
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
    if (this.scheduler.doesExist("timeout", FLAKE_RESCORE_TIMEOUT)) {
      this.scheduler.deleteTimeout(FLAKE_RESCORE_TIMEOUT);
    }

    try {
      this.announce(await this.scorer.rescoreAll());
    } catch (error) {
      // The workspaces could not even be listed — the database is unreachable. A night is lost,
      // not the loop.
      this.logger.error(
        "Nightly flake re-score could not start; retrying tomorrow.",
        describeForLog(error),
      );
    }

    this.book();
  }

  /**
   * Say what a night did, when it did anything. A deployment with nothing to re-score is silent.
   *
   * @param report - The night.
   */
  private announce(report: RescoreReport): void {
    if (report.workspaces.length === 0) {
      return;
    }

    const failed = report.workspaces.filter((workspace) => workspace.status === "error");
    const sum = (field: "casesScored" | "stateChanges"): number =>
      report.workspaces.reduce((total, workspace) => total + workspace[field], 0);
    const candidates = report.workspaces.reduce(
      (total, workspace) => total + workspace.candidates.length,
      0,
    );

    this.logger.log(
      `Flake re-score (formula v${String(report.formulaVersion)}, cap ${String(report.cap)}): ` +
        `${String(report.workspaces.length)} workspace(s), ${String(sum("casesScored"))} case(s) ` +
        `scored, ${String(sum("stateChanges"))} state change(s), ${String(candidates)} candidate(s)` +
        `${failed.length === 0 ? "" : `; ${String(failed.length)} failed`}.`,
    );
  }

  /** Book the next slot, jittered, unless the application is going away. */
  private book(): void {
    if (this.stopped) {
      return;
    }

    const now = this.now();
    const slot = nextNightlySlot(now, this.config.flakeRescoreHourUtc);
    const timer = setTimeout(
      () => {
        void this.tick();
      },
      nightlyDelay(now, slot, FLAKE_RESCORE_JITTER_MINUTES),
    );

    // The loop must not be the reason a process stays alive.
    timer.unref();

    this.scheduler.addTimeout(FLAKE_RESCORE_TIMEOUT, timer);
  }
}
