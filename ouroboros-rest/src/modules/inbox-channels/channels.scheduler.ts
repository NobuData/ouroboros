/**
 * What makes the decision channels periodic (BN.3, [#463](https://github.com/NobuData/ouroboros/issues/463)).
 *
 * The shape of `insights/digest/digest.scheduler.ts` — a jittered self-rescheduling timeout, a
 * pass that never overlaps itself, a failed pass that costs a tick rather than the loop, and an
 * unreferenced timer. One pass:
 *
 * ```
 * mirror.sweep()   retry every item whose PR comment is behind (failures recorded, never raised)
 * mail.pass()      fail abandoned claims · retry failed instant mails · send due daily digests
 * ```
 *
 * **The tick is not the schedule.** A digest's slot is the person's `digest_time`; the tick is only
 * how late after it a digest may leave. Every replica ticks: sends are claimed by unique keys and
 * comments are keyed by item, so no leader election is needed.
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
import { DecisionMailService } from "./mail/decision-mail.service";
import { DecisionMirrorService } from "./mirror/mirror.service";

/** How the timer names itself in `SchedulerRegistry`. */
export const CHANNELS_TIMEOUT = "decision-channels-tick";

/** The tick: a minute, so a digest leaves within about a minute of its slot. */
export const CHANNELS_TICK_MS = 60 * 1000;

@Injectable()
export class ChannelsScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ChannelsScheduler.name);

  /** Set once the application is shutting down. */
  private stopped = false;

  /** The pass in flight, so a second caller joins it rather than starting another. */
  private pass?: Promise<void>;

  /**
   * @param mirror - The GitHub mirror's retry sweep.
   * @param mail - The email channel's pass.
   * @param scheduler - Nest's registry, where every timer in this process is inspectable.
   */
  constructor(
    private readonly mirror: DecisionMirrorService,
    private readonly mail: DecisionMailService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /** Book the first tick once the application is up. */
  onApplicationBootstrap(): void {
    this.schedule();
  }

  /** Stop the loop and clear a pending timer. */
  onApplicationShutdown(): void {
    this.stopped = true;

    if (this.scheduler.doesExist("timeout", CHANNELS_TIMEOUT)) {
      this.scheduler.deleteTimeout(CHANNELS_TIMEOUT);
    }
  }

  /**
   * Run one pass and book the next. A call made while a pass is running joins it.
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
   * One pass, and the next tick booked whatever it did. Never rejects.
   *
   * @returns When the pass has settled.
   */
  private async run(): Promise<void> {
    if (this.scheduler.doesExist("timeout", CHANNELS_TIMEOUT)) {
      this.scheduler.deleteTimeout(CHANNELS_TIMEOUT);
    }

    try {
      const outcomes = await this.mirror.sweep();
      const failed = [...outcomes.values()].filter((outcome) => outcome === "failed").length;

      if (failed > 0) {
        this.logger.warn(`Decision mirror: ${String(failed)} comment(s) still failing.`);
      }
    } catch (error) {
      this.logger.error("The decision mirror sweep could not run.", describeForLog(error));
    }

    try {
      const report = await this.mail.pass();

      if (report.failed > 0) {
        this.logger.warn(
          `Decision mail: ${String(report.instantSent)} instant and ${String(report.digestSent)} digest sent, ${String(report.failed)} failed; will retry.`,
        );
      }
    } catch (error) {
      this.logger.error("The decision mail pass could not run.", describeForLog(error));
    }

    this.schedule();
  }

  /** Book the next tick, jittered, unless the application is going away. */
  private schedule(): void {
    if (this.stopped) {
      return;
    }

    const timer = setTimeout(() => {
      void this.tick();
    }, jittered(CHANNELS_TICK_MS));

    // The loop must not be the reason a process stays alive.
    timer.unref();

    this.scheduler.addTimeout(CHANNELS_TIMEOUT, timer);
  }
}
