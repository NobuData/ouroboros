/**
 * What makes the recovery sweep periodic — the third self-rescheduling loop in this service.
 *
 * L.3 ([#107](https://github.com/NobuData/ouroboros/issues/107)), and deliberately the same
 * shape as `backlog-sync/backlog-sync.scheduler.ts` and
 * `provider-health/provider-health.scheduler.ts`. The four properties that shape is chosen for
 * hold here too, and the reasons are written out in the first of those files: a jittered
 * self-rescheduling timeout rather than `@Interval`, a cycle that never overlaps itself, a
 * failed cycle that costs a cycle rather than the loop, and an unreferenced timer so a suite
 * that built an application without listening still exits.
 *
 * ---------------------------------------------------------------------------
 * **What this loop is for, in one sentence:** a process that stopped existing between the
 * claim and the write left a row saying `estimating` that nothing is estimating, and this is
 * what notices.
 *
 * Everything *inside* a running process is already covered — every path out of
 * `EstimationOrchestrator.run()` writes a terminal status, including the one where the write
 * itself failed. So this loop is not a backstop for bugs in that code; it is the answer to
 * `SIGKILL`, to a container rescheduled mid-estimate, and to a deployment rolled while an
 * import was running. Which is why it re-queues rather than repairs: the row is not damaged,
 * nobody is working on it.
 *
 * **It logs only when it did something.** A healthy service sweeps up nothing, over and over,
 * and a loop that announced every empty result would be a log nobody reads by the second day —
 * `backlog-sync.scheduler.ts` makes the same choice for the same reason. The exception is a
 * sweep that found only work already in flight: that means the staleness threshold is set below
 * how long an estimate legitimately takes, which is a misconfiguration nothing else would ever
 * report.
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
import { EstimationOrchestrator, type SweepReport } from "./estimation.orchestrator";

/**
 * How the timer names itself in `SchedulerRegistry`.
 *
 * One name for one timer, which is what makes the delete on shutdown unambiguous and what an
 * operator listing the registry sees beside `backlog-sync-cycle` and `provider-health-sweep`.
 */
export const SWEEP_TIMEOUT = "estimation-recovery-sweep";

@Injectable()
export class EstimationSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  /** Where a sweep that could not run is reported. */
  private readonly logger = new Logger(EstimationSweeper.name);

  /**
   * Set once the application is shutting down.
   *
   * The guard that closes the race between a shutdown and a sweep already in flight: the sweep
   * finishes, tries to schedule the next tick, and finds the loop closed. Without it,
   * `app.close()` during a sweep would leave a live timer behind a destroyed injector.
   */
  private stopped = false;

  /**
   * @param orchestrator - The pipeline. This class owns *when* a sweep happens and nothing
   *   about what one does.
   * @param config - The sweep cadence, from the environment.
   * @param scheduler - Nest's registry. The timer is registered rather than merely held, so
   *   there is one inspectable place every scheduled thing in this process lives.
   */
  constructor(
    private readonly orchestrator: EstimationOrchestrator,
    private readonly config: AppConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /**
   * Start the loop once the application is up.
   *
   * `onApplicationBootstrap` rather than `onModuleInit`, for `backlog-sync.scheduler.ts`'s
   * reason: the first sweep opens a database connection, and doing that while other modules are
   * still initialising makes the order of two unrelated things matter. Nothing runs
   * immediately — the first delay is a full jittered interval, which is also what stops a fleet
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

    if (this.scheduler.doesExist("timeout", SWEEP_TIMEOUT)) {
      this.scheduler.deleteTimeout(SWEEP_TIMEOUT);
    }
  }

  /**
   * Run one sweep and schedule the next, whatever the first did.
   *
   * Public so a test can drive a sweep without waiting for a timer, and so a future operator
   * endpoint has something to call that is not the private scheduling machinery.
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
      this.announce(await this.orchestrator.sweep());
    } catch (error) {
      // A sweep is lost, not the loop. What reaches here is this deployment's own database
      // being unreachable — the sweep makes no outbound request of its own — and a caught
      // error that stopped rescheduling would leave a process that looks healthy and has
      // silently stopped recovering anything.
      this.logger.error(
        "Estimation recovery sweep failed; retrying next tick.",
        describeForLog(error),
      );
    }

    this.schedule(this.interval());
  }

  /**
   * Say what a sweep did, when it did anything worth saying.
   *
   * @param report - The sweep.
   */
  private announce(report: SweepReport): void {
    if (report.stale === 0) {
      return;
    }

    if (report.requeued === 0) {
      this.logger.warn(
        `Estimation sweep: all ${String(report.stale)} row(s) older than ` +
          `${String(this.config.estimationStaleSeconds)}s are already being estimated here. ` +
          "OURO_ESTIMATION_STALE_SECONDS is below how long an estimate takes in this " +
          "deployment; raise it, or the sweep will keep reading work it cannot start.",
      );
      return;
    }

    this.logger.log(
      `Estimation sweep: re-queued ${String(report.requeued)} stranded issue(s)` +
        `${report.inFlight === 0 ? "" : `, ${String(report.inFlight)} already in flight`}.`,
    );
  }

  /**
   * The nominal delay, jittered.
   *
   * @returns Milliseconds. `scheduling/cadence.ts` argues why the jitter matters and why the
   *   *first* delay is jittered too.
   */
  private interval(): number {
    return jittered(this.config.estimationSweepIntervalSeconds * 1000);
  }

  /**
   * Book the next tick, unless the application is going away.
   *
   * @param delayMs - How long to wait.
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

    this.scheduler.addTimeout(SWEEP_TIMEOUT, timer);
  }
}
