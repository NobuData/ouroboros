/**
 * What makes the org notification routes periodic (BR.4,
 * [#488](https://github.com/NobuData/ouroboros/issues/488)) — the shape of
 * `inbox-channels/channels.scheduler.ts`: a jittered self-rescheduling timeout, a pass that never
 * overlaps itself, a failed pass that costs a tick rather than the loop, and an unreferenced timer.
 *
 * **The tick is not the schedule.** A route's slot is its configured time; the tick only bounds
 * how late after it the mail leaves. Every replica ticks: sends are claimed by unique keys, so no
 * leader election is needed. No timer is booked on a deployment with no mail server.
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { describeForLog } from "../errors/failure";
import { MAILER, type Mailer } from "../mail/mailer";
import { jittered } from "../scheduling/cadence";
import { OrgRouteSender } from "./routes.sender";

/** How the timer names itself in `SchedulerRegistry`. */
export const ROUTES_TIMEOUT = "notification-routes-tick";

/** The tick: a minute, so a route's mail leaves within about a minute of its slot. */
export const ROUTES_TICK_MS = 60 * 1000;

@Injectable()
export class NotificationRoutesScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationRoutesScheduler.name);

  /** Set once the application is shutting down. */
  private stopped = false;

  /** The pass in flight, so a second caller joins it rather than starting another. */
  private pass?: Promise<void>;

  /**
   * @param sender - The routes' sender.
   * @param mailer - This deployment's mailer — no mail server, no timer.
   * @param scheduler - Nest's registry, where every timer in this process is inspectable.
   */
  constructor(
    private readonly sender: OrgRouteSender,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /** Book the first tick once the application is up, when this deployment can send mail. */
  onApplicationBootstrap(): void {
    if (this.mailer.transport !== "none") {
      this.schedule();
    }
  }

  /** Stop the loop and clear a pending timer. */
  onApplicationShutdown(): void {
    this.stopped = true;

    if (this.scheduler.doesExist("timeout", ROUTES_TIMEOUT)) {
      this.scheduler.deleteTimeout(ROUTES_TIMEOUT);
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
    if (this.scheduler.doesExist("timeout", ROUTES_TIMEOUT)) {
      this.scheduler.deleteTimeout(ROUTES_TIMEOUT);
    }

    try {
      const report = await this.sender.tick();
      const failed = report.outcomes.reduce((sum, outcome) => sum + outcome.failed, 0);

      if (failed > 0 || report.errors.length > 0) {
        this.logger.warn(
          `Notification routes: ${String(failed)} send(s) failed and ${String(report.errors.length)} route(s) could not run; will retry.`,
        );
      }
    } catch (error) {
      this.logger.error("The notification routes pass could not run.", describeForLog(error));
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
    }, jittered(ROUTES_TICK_MS));

    // The loop must not be the reason a process stays alive.
    timer.unref();

    this.scheduler.addTimeout(ROUTES_TIMEOUT, timer);
  }
}
