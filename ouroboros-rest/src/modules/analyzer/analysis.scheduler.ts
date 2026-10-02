/**
 * What makes the Build Analyzer periodic: the weekly trigger, and the reaper that keeps an
 * abandoned run from holding its repository's guard shut (BV.1,
 * [#510](https://github.com/NobuData/ouroboros/issues/510), decision **A7**).
 *
 * The shape of `insights/digest/digest.scheduler.ts` — a jittered self-rescheduling timeout, a pass
 * that never overlaps itself, a failed pass that costs a tick rather than the loop, an unreferenced
 * timer.
 *
 * **The tick is not the schedule.** Each tick asks which repositories' weekly slot
 * (`analysis_schedules.weekly_day` + `weekly_time`, UTC) has passed with no analysis started since,
 * and starts one for each. A process that was down across a slot runs it when it returns; a slot
 * from before the schedule existed never fires. Every replica ticks: the concurrent-run guard is
 * what makes two replicas firing the same slot one run.
 *
 * The every-N-builds trigger is not here — it is driven by job completions
 * (`analysis.counter.ts`) — and the manual one is the controller's.
 */

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { ConflictError } from "../errors/error.envelope";
import { describeForLog } from "../errors/failure";
import { jittered, latestWeeklySlot } from "../scheduling/cadence";
import { ANALYSIS_CLOCK, AnalysisOrchestrator } from "./analysis.orchestrator";
import { AnalysisRepository, type WeeklySchedule } from "./analysis.repository";

/** How the timer names itself in `SchedulerRegistry`. */
export const ANALYZER_TIMEOUT = "analyzer-tick";

/** Milliseconds between ticks — a weekly run starts within about a minute of its slot. */
export const ANALYZER_TICK_MS = 60_000;

/**
 * How long past its compute ceiling a running analysis is presumed abandoned — its process
 * stopped without ending it. Fifteen minutes: well past the dispatch margin, so a run that is
 * merely finishing is never reaped.
 */
export const REAP_GRACE_SECONDS = 900;

/** The reason a reaped run records. */
export const REAPED_REASON =
  "The run did not finish within its compute ceiling; its process stopped before it could end it.";

/**
 * Whether a weekly schedule's latest slot is due.
 *
 * @param schedule - The schedule, with when its repository last started an analysis.
 * @param now - The current instant.
 * @returns The slot when due — after the schedule was created and after the repository's last
 *   start — otherwise undefined. A manual or every-N run after the slot counts: a week does not
 *   need two analyses because one of them was asked for.
 */
export function dueSlot(schedule: WeeklySchedule, now: Date): Date | undefined {
  const slot = latestWeeklySlot(now, schedule.weeklyDay, schedule.weeklyTime);

  if (slot.getTime() < schedule.createdAt.getTime()) {
    return undefined;
  }
  if (schedule.lastStartedAt !== null && schedule.lastStartedAt.getTime() >= slot.getTime()) {
    return undefined;
  }

  return slot;
}

@Injectable()
export class AnalysisScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  /** Where each tick's starts and failures are reported. */
  private readonly logger = new Logger(AnalysisScheduler.name);

  /** Set once the application is shutting down. */
  private stopped = false;

  /** The pass in flight, so a second caller joins it rather than starting another. */
  private pass?: Promise<void>;

  /**
   * @param runs - The run records: the reaper and the weekly schedules.
   * @param orchestrator - Where a due slot starts its run.
   * @param scheduler - Nest's registry, where every timer in this process is inspectable.
   * @param clock - The current instant; `Date.now` unless a suite binds one.
   */
  constructor(
    private readonly runs: AnalysisRepository,
    private readonly orchestrator: AnalysisOrchestrator,
    private readonly scheduler: SchedulerRegistry,
    @Optional() @Inject(ANALYSIS_CLOCK) private readonly clock: () => number = Date.now,
  ) {}

  /** Book the first tick once the application is up. */
  onApplicationBootstrap(): void {
    this.schedule();
  }

  /** Stop the loop and clear a pending timer. */
  onApplicationShutdown(): void {
    this.stopped = true;

    if (this.scheduler.doesExist("timeout", ANALYZER_TIMEOUT)) {
      this.scheduler.deleteTimeout(ANALYZER_TIMEOUT);
    }
  }

  /**
   * Run one pass and book the next. A call made while a pass is running joins it.
   *
   * @returns When the pass has settled.
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
   * One pass: reap, then start every due weekly run. Never rejects.
   *
   * @returns When settled and the next tick is booked.
   */
  private async run(): Promise<void> {
    if (this.scheduler.doesExist("timeout", ANALYZER_TIMEOUT)) {
      this.scheduler.deleteTimeout(ANALYZER_TIMEOUT);
    }

    try {
      const reaped = await this.runs.reapStale(REAP_GRACE_SECONDS, REAPED_REASON);
      for (const id of reaped) {
        this.logger.warn(`Analysis ${id} outlived its compute ceiling and was marked failed.`);
      }

      await this.startDue(new Date(this.clock()));
    } catch (error) {
      this.logger.error(
        "The analyzer tick could not run; retrying next tick.",
        describeForLog(error),
      );
    }

    this.schedule();
  }

  /**
   * Start a weekly run for every schedule whose slot is due.
   *
   * @param now - The current instant.
   * @returns When each has been started or refused.
   */
  private async startDue(now: Date): Promise<void> {
    for (const schedule of await this.runs.weeklySchedules()) {
      const slot = dueSlot(schedule, now);
      if (slot === undefined) {
        continue;
      }

      try {
        const run = await this.orchestrator.start({
          organizationId: schedule.organizationId,
          repoRef: schedule.repoRef,
          trigger: "weekly",
          scheduleId: schedule.id,
        });
        this.logger.log(
          `Weekly analysis ${run.id} of ${schedule.repoRef} started for the ${slot.toISOString()} slot.`,
        );
      } catch (error) {
        if (error instanceof ConflictError) {
          // Already running: the run in flight covers this slot.
          continue;
        }
        this.logger.error(
          `The weekly analysis of ${schedule.repoRef} could not start; retrying next tick.`,
          describeForLog(error),
        );
      }
    }
  }

  /** Book the next tick, jittered, unless the application is going away. */
  private schedule(): void {
    if (this.stopped) {
      return;
    }

    const timer = setTimeout(() => {
      void this.tick();
    }, jittered(ANALYZER_TICK_MS));

    // The loop must not be the reason a process stays alive.
    timer.unref();

    this.scheduler.addTimeout(ANALYZER_TIMEOUT, timer);
  }
}
