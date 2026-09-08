/**
 * What makes the backlog sync periodic — the second self-rescheduling loop in this service.
 *
 * K.4 ([#102](https://github.com/NobuData/ouroboros/issues/102)). It is deliberately the same
 * shape as `provider-health/provider-health.scheduler.ts`, because the four properties that
 * shape is chosen for are the same ones here:
 *
 *   * **A self-rescheduling timeout rather than `@Interval` or `@Cron`, because the cadence has
 *     to be jittered.** A decorator fixes its period when the class is defined; the issue asks
 *     for scheduling *"with jitter"*, which means a period that differs on every tick and
 *     between deployments. The timer is registered with `SchedulerRegistry` so it has a name,
 *     a place an operator can see it, and one owner responsible for clearing it.
 *   * **A cycle never overlaps itself.** The next delay is computed once the previous cycle has
 *     settled. Two cycles in flight would walk the same repositories twice, spend the token's
 *     budget twice for one answer, and race each other's upserts — and the second one would
 *     write the older read.
 *   * **A failed cycle is logged and the loop continues.** A database that is briefly down
 *     should cost a cycle, not the poller. Anything GitHub did is already a *pause* rather than
 *     a throw (see `sync.report.ts`), so what reaches the `catch` here is this deployment's own
 *     fault — and a caught error that stopped rescheduling would leave a process that looks
 *     healthy and has silently stopped watching anything.
 *   * **The timer is unreferenced.** The HTTP server is what holds the process open; a
 *     referenced timer in a test that built an application and never listened is a worker that
 *     hangs after its assertions have passed.
 *
 * ---------------------------------------------------------------------------
 * **One thing is this loop's own: a cycle that left known work behind books the next one in a
 * second.** A poll stops at `MAX_ISSUES_PER_POLL`, so a cold import of a large backlog is
 * several cycles rather than one; making each of those wait a full interval would turn a
 * five-thousand-issue repository's first sync into an afternoon, for a queue whose next page is
 * already known to exist. `cadence.ts` carries the argument, and the report's `pending` flag is
 * what says so.
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
import { BacklogSyncService } from "./backlog-sync.service";
import { CONTINUATION_DELAY_MS } from "./cadence";
import { cycleTotals, type SyncCycleReport } from "./sync.report";

/**
 * How the timer names itself in `SchedulerRegistry`.
 *
 * One name for one timer, which is what makes the delete on shutdown unambiguous and what an
 * operator listing the registry sees beside `provider-health-sweep`.
 */
export const SYNC_TIMEOUT = "backlog-sync-cycle";

@Injectable()
export class BacklogSyncScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  /** Where a cycle that could not run is reported. */
  private readonly logger = new Logger(BacklogSyncScheduler.name);

  /**
   * Set once the application is shutting down.
   *
   * The guard that closes the race between a shutdown and a cycle already in flight: the cycle
   * finishes, tries to schedule the next tick, and finds the loop closed. Without it,
   * `app.close()` during a cycle would leave a live timer behind a destroyed injector.
   */
  private stopped = false;

  /**
   * @param sync - The cycle.
   * @param config - The base interval, from the environment.
   * @param scheduler - Nest's registry. The timer is registered rather than merely held, so
   *   there is one inspectable place every scheduled thing in this process lives.
   */
  constructor(
    private readonly sync: BacklogSyncService,
    private readonly config: AppConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /**
   * Start the loop once the application is up.
   *
   * `onApplicationBootstrap` rather than `onModuleInit`: the first cycle opens a database
   * connection, a vault round trip and outbound sockets, and doing that while other modules are
   * still initialising makes the order of two unrelated things matter. Nothing runs immediately
   * in any case — the first delay is a full jittered interval, which is what stops a fleet
   * restarted together from converging on one schedule.
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

    if (this.scheduler.doesExist("timeout", SYNC_TIMEOUT)) {
      this.scheduler.deleteTimeout(SYNC_TIMEOUT);
    }
  }

  /**
   * Run one cycle and schedule the next, whatever the first did.
   *
   * Public so a test can drive a cycle without waiting for a timer, and so M.4's manual re-sync
   * ([#113](https://github.com/NobuData/ouroboros/issues/113)) has something to call that is not
   * the private scheduling machinery.
   *
   * @returns When the cycle has settled and the next tick is booked.
   */
  async tick(): Promise<void> {
    // The registry still holds the entry for the timer that just fired; dropping it before the
    // work starts keeps the invariant that at most one cycle timeout exists under this name.
    if (this.scheduler.doesExist("timeout", SYNC_TIMEOUT)) {
      this.scheduler.deleteTimeout(SYNC_TIMEOUT);
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
      this.logger.error("Backlog sync cycle failed; retrying next cycle.", describeForLog(error));
    }

    this.schedule(delay);
  }

  /**
   * Say what a cycle did, when it did anything.
   *
   * A cycle over a workspace with nothing to poll is silent by design: a background loop that
   * logged every quiet interval would be a log nobody reads by the second day, and the pause
   * reasons themselves are logged where they are decided, once each.
   *
   * @param report - The cycle.
   */
  private announce(report: SyncCycleReport): void {
    const totals = cycleTotals(report);

    if (totals.repositories === 0) {
      return;
    }

    this.logger.log(
      `Backlog sync: polled ${String(totals.repositories)} repositories — ` +
        `${String(totals.imported)} imported, ${String(totals.updated)} updated, ` +
        `${String(totals.unchanged)} unchanged, ${String(totals.enqueued)} ready to estimate.`,
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
   * @param delayMs - How long to wait. A full jittered interval normally; one second when the
   *   cycle reported known work still pending.
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

    this.scheduler.addTimeout(SYNC_TIMEOUT, timer);
  }
}
