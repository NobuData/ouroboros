/**
 * What makes the weekly digest periodic (BJ.4,
 * [#440](https://github.com/NobuData/ouroboros/issues/440)).
 *
 * The shape of `rollup/rollup.scheduler.ts` — a jittered self-rescheduling timeout, a pass that
 * never overlaps itself, a failed pass that costs a tick rather than the loop, and an
 * unreferenced timer.
 *
 * **The tick is not the schedule.** A tick asks which workspaces' weekly slot has come due
 * (`digest.runner.ts`); `OURO_INSIGHTS_DIGEST_INTERVAL_SECONDS` is only how late after its slot a
 * digest may leave. Every replica ticks: a run and each of its recipients are claimed by unique
 * keys, so no leader election is needed.
 *
 * **A deployment with no mail server books no timer**, and says so once at boot. The digest is
 * then off, which `GET /api/v1/insights/digest` reports as `mail.transport: "none"`.
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { AppConfigService } from "../../config/config.service";
import { describeForLog } from "../../errors/failure";
import { MAILER, type Mailer } from "../../mail/mailer";
import { jittered } from "../../scheduling/cadence";
import { DigestRunner, type DigestReport } from "./digest.runner";

/** How the timer names itself in `SchedulerRegistry`. */
export const DIGEST_TIMEOUT = "insights-digest-tick";

@Injectable()
export class DigestScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  /** Where a tick's sends and failures are reported. */
  private readonly logger = new Logger(DigestScheduler.name);

  /** Set once the application is shutting down. */
  private stopped = false;

  /** The pass in flight, so a second caller joins it rather than starting another. */
  private pass?: Promise<void>;

  /**
   * @param runner - One pass. This class owns *when*, and nothing about *what*.
   * @param mailer - This deployment's mailer, for whether there is anything to schedule.
   * @param config - The cadence.
   * @param scheduler - Nest's registry, where every timer in this process is inspectable.
   */
  constructor(
    private readonly runner: DigestRunner,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly config: AppConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /** Book the first tick once the application is up — unless this deployment sends no mail. */
  onApplicationBootstrap(): void {
    if (this.mailer.transport === "none") {
      this.logger.log(
        "The weekly Insights digest is off: no mail server is configured (OURO_SMTP_URL).",
      );
      return;
    }

    this.schedule();
  }

  /** Stop the loop, clear a pending timer, and let a run in flight end after its recipient. */
  onApplicationShutdown(): void {
    this.stopped = true;
    this.runner.stop();

    if (this.scheduler.doesExist("timeout", DIGEST_TIMEOUT)) {
      this.scheduler.deleteTimeout(DIGEST_TIMEOUT);
    }
  }

  /**
   * Run one pass and book the next, whatever the first did. A call made while a pass is running
   * joins it.
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
   * One pass, and the next tick booked whatever it did.
   *
   * @returns When the pass has settled. Never rejects.
   */
  private async run(): Promise<void> {
    if (this.scheduler.doesExist("timeout", DIGEST_TIMEOUT)) {
      this.scheduler.deleteTimeout(DIGEST_TIMEOUT);
    }

    try {
      this.announce(await this.runner.tick());
    } catch (error) {
      // The subscriptions could not be read — the database is unreachable. A tick is lost, not
      // the loop.
      this.logger.error(
        "The weekly digest could not start; retrying next tick.",
        describeForLog(error),
      );
    }

    this.schedule();
  }

  /**
   * Say what a pass did, when it did anything.
   *
   * Addresses are not logged: who was mailed is the send audit's to say, to whoever may read it.
   *
   * @param report - The pass.
   */
  private announce(report: DigestReport): void {
    for (const outcome of report.outcomes) {
      const line =
        `Weekly digest for workspace ${outcome.organizationId} ` +
        `(slot ${outcome.slotAt.toISOString()}): ${String(outcome.sent)} sent, ` +
        `${String(outcome.failed)} failed${outcome.completed ? "" : "; will retry"}.`;

      if (outcome.failed > 0) {
        this.logger.warn(line);
      } else if (outcome.sent > 0) {
        this.logger.log(line);
      }
    }

    for (const failure of report.errors) {
      this.logger.error(
        `Weekly digest for workspace ${failure.organizationId} could not run; retrying next tick.`,
        failure.error,
      );
    }
  }

  /** Book the next tick, jittered, unless the application is going away. */
  private schedule(): void {
    if (this.stopped) {
      return;
    }

    const timer = setTimeout(
      () => {
        void this.tick();
      },
      jittered(this.config.insightsDigestIntervalSeconds * 1000),
    );

    // The loop must not be the reason a process stays alive.
    timer.unref();

    this.scheduler.addTimeout(DIGEST_TIMEOUT, timer);
  }
}
