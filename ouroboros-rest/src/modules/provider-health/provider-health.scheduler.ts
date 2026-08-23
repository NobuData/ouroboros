/**
 * What makes the sweep periodic — and the first periodic work in `ouroboros-rest`.
 *
 * `vault.rotation.ts`'s header records the state of the world before this ticket: *"this
 * service has no periodic work anywhere and no `@nestjs/schedule` dependency"*, and says that
 * acquiring one was a larger change than that ticket. Z.3
 * ([#196](https://github.com/NobuData/ouroboros/issues/196)) is the ticket that acquires it —
 * a health strip is periodic work by definition — and this is the whole of what it added.
 *
 * ---------------------------------------------------------------------------
 * **A self-rescheduling timeout rather than `@Interval` or `@Cron`, because the cadence has to
 * be jittered.** A decorator fixes its period when the class is defined; the acceptance
 * criterion asks for a period that is different on every tick and different between
 * deployments. So each tick schedules the next one, through `SchedulerRegistry` — which is
 * what gives the timer a name, a place an operator can see it, and a single owner responsible
 * for clearing it. `cadence.ts` argues why the jitter matters and why the *first* delay is
 * jittered too.
 *
 * **The sweep never overlaps itself.** The next delay is computed after the previous sweep has
 * settled rather than on a fixed schedule, so a cycle that runs long delays the following one
 * instead of stacking on top of it. Fifty probes with a five-second deadline can exceed a
 * one-minute interval on a bad day, and two sweeps in flight would check the same rows twice
 * and write the older answer second.
 *
 * **A failed sweep is logged and the loop continues.** A database that is briefly down should
 * cost a cycle, not the scheduler: a caught error that stopped rescheduling would leave a
 * process that looks healthy and has silently stopped checking anything until it is restarted.
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
import { jittered } from "./cadence";
import { ProviderHealthService } from "./provider-health.service";

/**
 * How the timer names itself in `SchedulerRegistry`.
 *
 * One name for one timer, which is what makes {@link ProviderHealthScheduler.stop}'s delete
 * unambiguous and what an operator listing the registry sees.
 */
export const SWEEP_TIMEOUT = "provider-health-sweep";

@Injectable()
export class ProviderHealthScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  /** Where a sweep that could not run is reported. */
  private readonly logger = new Logger(ProviderHealthScheduler.name);

  /**
   * Set once the application is shutting down.
   *
   * The guard that closes the race between a shutdown and a sweep already in flight: the
   * sweep finishes, tries to schedule the next tick, and finds the loop closed. Without it,
   * `app.close()` during a sweep would leave a live timer behind a destroyed injector — which
   * in a test run is a worker that never exits and in production is a query against a drained
   * pool.
   */
  private stopped = false;

  /**
   * @param health - The sweep.
   * @param config - The base interval, from the environment.
   * @param scheduler - Nest's registry. The timer is registered rather than merely held, so
   *   there is one inspectable place every scheduled thing in this process lives.
   */
  constructor(
    private readonly health: ProviderHealthService,
    private readonly config: AppConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /**
   * Start the loop once the application is up.
   *
   * `onApplicationBootstrap` rather than `onModuleInit`: the first sweep opens a database
   * connection and outbound sockets, and doing that while other modules are still
   * initialising makes the order of two unrelated things matter. Nothing runs immediately in
   * any case — the first delay is a full jittered interval, which is what stops a fleet
   * restarted together from converging on one schedule.
   */
  onApplicationBootstrap(): void {
    this.schedule();
  }

  /**
   * Stop the loop, and clear a pending timer.
   *
   * Called by Nest on `app.close()` and on the signals `src/application.ts` enables.
   */
  onApplicationShutdown(): void {
    this.stopped = true;

    if (this.scheduler.doesExist("timeout", SWEEP_TIMEOUT)) {
      this.scheduler.deleteTimeout(SWEEP_TIMEOUT);
    }
  }

  /**
   * Run one sweep and schedule the next, whatever the first did.
   *
   * Public so a test can drive a cycle without waiting for a timer, and so an operator-facing
   * endpoint — should one ever be wanted — has something to call that is not the private
   * scheduling machinery.
   *
   * @returns When the sweep has settled and the next tick is booked.
   */
  async tick(): Promise<void> {
    // The registry still holds the entry for the timer that just fired; dropping it before the
    // work starts keeps the invariant that at most one sweep timeout exists under this name.
    if (this.scheduler.doesExist("timeout", SWEEP_TIMEOUT)) {
      this.scheduler.deleteTimeout(SWEEP_TIMEOUT);
    }

    try {
      const report = await this.health.sweep();

      if (report.checked > 0) {
        this.logger.log(
          `Provider health: checked ${report.checked.toString()} connections — ` +
            `${report.active.toString()} answered, ${report.failed.toString()} did not, ` +
            `${report.skipped.toString()} had nothing to check.`,
        );
      }
    } catch (error) {
      // A cycle is lost, not the loop. See this file's header.
      this.logger.error(
        "Provider health sweep failed; retrying next cycle.",
        describeForLog(error),
      );
    }

    this.schedule();
  }

  /**
   * Book the next tick, unless the application is going away.
   */
  private schedule(): void {
    if (this.stopped) {
      return;
    }

    const timer = setTimeout(
      () => {
        void this.tick();
      },
      jittered(this.config.providerHealthIntervalSeconds * 1000),
    );

    // The loop must not be the reason a process stays alive. The HTTP server is what holds it
    // open in production; in a test that built an application and never listened, a referenced
    // minute-long timer is a worker that hangs after its assertions have passed.
    timer.unref();

    this.scheduler.addTimeout(SWEEP_TIMEOUT, timer);
  }
}
