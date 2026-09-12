/**
 * What makes the ticket-source sync periodic — the fourth self-rescheduling loop in this
 * service.
 *
 * Q.2 ([#139](https://github.com/NobuData/ouroboros/issues/139)). Deliberately the same shape
 * as `backlog-sync/backlog-sync.scheduler.ts` and `provider-health/provider-health.scheduler.ts`,
 * because the four properties that shape is chosen for are the same ones here:
 *
 *   * **A self-rescheduling timeout rather than `@Interval` or `@Cron`, because the cadence has
 *     to be jittered.** A decorator fixes its period when the class is defined; what is wanted
 *     is a period that differs on every tick and between deployments, so a fleet of self-hosted
 *     installations does not arrive at somebody else's API in the same second every interval.
 *     The timer is registered with `SchedulerRegistry` so it has a name, a place an operator
 *     can see it, and one owner responsible for clearing it.
 *   * **A cycle never overlaps itself.** The next delay is computed once the previous cycle has
 *     settled. Two cycles in flight would sync the same sources twice, spend each credential's
 *     budget twice for one answer, and race each other's upserts — and the second would write
 *     the older read. Enforced by a held promise rather than implied by there being one loop,
 *     because Q.4's manual trigger ([#141](https://github.com/NobuData/ouroboros/issues/141))
 *     will be a second caller: a `tick()` that arrives mid-cycle joins the cycle already
 *     running.
 *   * **A failed cycle is logged and the loop continues.** A database that is briefly down
 *     should cost a cycle, not the poller. Anything a provider did is already a *failure on a
 *     source* rather than a throw (see `ticket-sources.service.ts`), so what reaches the
 *     `catch` here is this deployment's own fault — and a caught error that stopped
 *     rescheduling would leave a process that looks healthy and has silently stopped watching
 *     anything.
 *   * **The timer is unreferenced.** The HTTP server is what holds the process open; a
 *     referenced timer in a test that built an application and never listened is a worker that
 *     hangs after its assertions have passed.
 *
 * ---------------------------------------------------------------------------
 * **The interval is the backlog sync's, and that is a decision rather than an oversight.**
 *
 * `OURO_BACKLOG_SYNC_INTERVAL_SECONDS` already means *how often Ouroboros asks a tracker what
 * changed*, and this loop is that question generalized — the ticket that made it general is
 * this one, and the ticket that retires the GitHub-specific loop is Q.3
 * ([#140](https://github.com/NobuData/ouroboros/issues/140)). A second variable would be a
 * second knob for one cadence, live for exactly one release, and then a reconciliation Q.3 had
 * to perform while it was also moving the sync. What it costs in the meantime is that the two
 * loops share a period, which is what an operator setting one number would expect anyway.
 *
 * **What is worth knowing about running both:** with no provider registered this loop makes no
 * outbound request at all — `ticket-source.registry.ts` explains why that is the honest state
 * of this build — so until Q.3 lands it reads a handful of rows per interval and stops. It is
 * the backlog sync that is talking to github.com.
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
import { CONTINUATION_DELAY_MS } from "./cadence";
import { cycleTotals, type SyncCycleReport } from "./sync.report";
import { TicketSourcesService } from "./ticket-sources.service";

/**
 * How the timer names itself in `SchedulerRegistry`.
 *
 * One name for one timer, which is what makes the delete on shutdown unambiguous and what an
 * operator listing the registry sees beside `backlog-sync-cycle` and `provider-health-sweep`.
 */
export const TICKET_SYNC_TIMEOUT = "ticket-sources-cycle";

@Injectable()
export class TicketSourcesScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  /** Where a cycle that could not run is reported. */
  private readonly logger = new Logger(TicketSourcesScheduler.name);

  /**
   * Set once the application is shutting down.
   *
   * The guard that closes the race between a shutdown and a cycle already in flight: the cycle
   * finishes, tries to schedule the next tick, and finds the loop closed. Without it,
   * `app.close()` during a cycle would leave a live timer behind a destroyed injector.
   */
  private stopped = false;

  /**
   * The cycle in flight, or `undefined` when none is.
   *
   * Held as the promise rather than as a boolean so a caller can *join* the cycle already
   * running instead of starting a second one, and so {@link runNow} has something to hand a
   * trigger to await.
   */
  private cycle?: Promise<void>;

  /**
   * @param sync - The cycle.
   * @param config - The base interval, from the environment. See this file's header on why it
   *   is the backlog sync's.
   * @param scheduler - Nest's registry. The timer is registered rather than merely held, so
   *   there is one inspectable place every scheduled thing in this process lives.
   */
  constructor(
    private readonly sync: TicketSourcesService,
    private readonly config: AppConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /**
   * Start the loop once the application is up.
   *
   * `onApplicationBootstrap` rather than `onModuleInit`: the first cycle opens a database
   * connection, a vault round trip and — once a provider is registered — outbound sockets, and
   * doing that while other modules are still initialising makes the order of two unrelated
   * things matter. Nothing runs immediately in any case: the first delay is a full jittered
   * interval, which is what stops a fleet restarted together from converging on one schedule.
   */
  onApplicationBootstrap(): void {
    this.schedule(this.interval());
  }

  /**
   * Stop the loop, and clear a pending timer.
   *
   * Called by Nest on `app.close()` and on the signals `src/application.ts` enables.
   */
  onApplicationShutdown(): void {
    this.stopped = true;

    if (this.scheduler.doesExist("timeout", TICKET_SYNC_TIMEOUT)) {
      this.scheduler.deleteTimeout(TICKET_SYNC_TIMEOUT);
    }
  }

  /**
   * Run one cycle and schedule the next, whatever the first did.
   *
   * Public so a test can drive a cycle without waiting for a timer, and so Q.4's manual re-sync
   * has something to call that is not the private scheduling machinery.
   *
   * **A call made while a cycle is running joins it rather than starting a second one.** The
   * caller still waits for a cycle and still gets a settled one; what it does not get is a
   * second sync of the same sources.
   *
   * @returns When the cycle has settled and the next tick is booked.
   */
  async tick(): Promise<void> {
    const running = this.cycle;

    if (running !== undefined) {
      await running;
      return;
    }

    const started = this.run();

    // Assigned before the first `await` of this method, so a caller checking {@link running}
    // synchronously after driving one sees it.
    this.cycle = started;

    try {
      await started;
    } finally {
      this.cycle = undefined;
    }
  }

  /**
   * Start a cycle now, ahead of the booked one, unless one is already running.
   *
   * The check and the start are one synchronous step, which is what makes *"concurrent trigger
   * → 409"* a property rather than a race: two requests arriving in the same tick of the event
   * loop cannot both be the one that started a cycle.
   *
   * @returns The cycle, for a caller that wants to await it, or `undefined` when one was
   *   already running — which is Q.4's `409`. The promise never rejects; {@link tick} logs a
   *   failed cycle and books the next one.
   */
  runNow(): Promise<void> | undefined {
    if (this.cycle !== undefined) {
      return undefined;
    }

    return this.tick();
  }

  /**
   * Whether a cycle is in flight.
   *
   * @returns `true` while one is running, the timer's or a trigger's alike.
   */
  running(): boolean {
    return this.cycle !== undefined;
  }

  /**
   * One cycle, and the next tick booked whatever this one did.
   *
   * @returns When the cycle has settled. Never rejects — see this file's header on what can
   *   reach the `catch` at all.
   */
  private async run(): Promise<void> {
    // The registry still holds the entry for the timer that just fired; dropping it before the
    // work starts keeps the invariant that at most one cycle timeout exists under this name. It
    // is also what stops a manual trigger from leaving the *booked* tick behind to fire on top
    // of the cycle it just ran.
    if (this.scheduler.doesExist("timeout", TICKET_SYNC_TIMEOUT)) {
      this.scheduler.deleteTimeout(TICKET_SYNC_TIMEOUT);
    }

    let delay = this.interval();

    try {
      const report = await this.sync.cycle();

      this.announce(report);

      if (report.pending) {
        delay = CONTINUATION_DELAY_MS;
      }
    } catch (error) {
      // A cycle is lost, not the loop. See this file's header on what can reach here at all.
      this.logger.error(
        "Ticket source sync cycle failed; retrying next cycle.",
        describeForLog(error),
      );
    }

    this.schedule(delay);
  }

  /**
   * Say what a cycle did, when it did anything.
   *
   * A cycle over a deployment with nothing to sync is silent by design: a background loop that
   * logged every quiet interval would be a log nobody reads by the second day. A *skip* is not
   * enough to speak for either — see `ticket-sources.service.ts` on why an unsupported kind is
   * a `debug` line — so the threshold is a source that was really polled or really failed.
   *
   * @param report - The cycle.
   */
  private announce(report: SyncCycleReport): void {
    const totals = cycleTotals(report);

    if (totals.polled === 0 && totals.failed === 0) {
      return;
    }

    this.logger.log(
      `Ticket sync: polled ${String(totals.polled)} source(s) — ` +
        `${String(totals.imported)} imported, ${String(totals.updated)} updated, ` +
        `${String(totals.unchanged)} unchanged, ${String(totals.enqueued)} ready to estimate` +
        `${totals.failed === 0 ? "" : `; ${String(totals.failed)} failed`}` +
        `${totals.skipped === 0 ? "" : `; ${String(totals.skipped)} unsupported`}.`,
    );
  }

  /**
   * The nominal delay, jittered.
   *
   * @returns Milliseconds. `scheduling/cadence.ts` argues why the jitter matters and why the
   *   *first* delay is jittered too.
   */
  private interval(): number {
    return jittered(this.config.backlogSyncIntervalSeconds * 1000);
  }

  /**
   * Book the next tick, unless the application is going away.
   *
   * @param delayMs - How long to wait. A full jittered interval normally; one second when a
   *   provider reported known work still pending.
   */
  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }

    const timer = setTimeout(() => {
      void this.tick();
    }, delayMs);

    // The loop must not be the reason a process stays alive — see this file's header.
    timer.unref();

    this.scheduler.addTimeout(TICKET_SYNC_TIMEOUT, timer);
  }
}
