/**
 * The run supervisor — the REST half of ADR decision A's crash-resume (#160).
 *
 * Every `OURO_RUN_SUPERVISOR_TICK_SECONDS` (5 by default) it does two things:
 *
 *   1. **Resubmits stale runs.** A live run in `coding`/`building` whose engine worker has not
 *      sent a heartbeat for `OURO_RUN_HEARTBEAT_STALE_SECONDS` (30 by default) — or that was
 *      opened that long ago and never started — is handed to `POST /v0/runs/{id}/execute`. The
 *      engine starts it under a new epoch, so a worker that was only slow, not dead, is fenced
 *      out of it (`409 fenced`) the moment it writes again.
 *   2. **Asks for claims**, only while `OURO_LIVE_EXECUTION_ENABLED`: one
 *      `POST /v0/execution/claims` per workspace that has a confirmed, unleased queue item. The
 *      claim (`queue-claim.service.ts`) re-checks every admission rule, so the read here only
 *      needs to be a superset.
 *
 * The shape is `live-limits.sweeper.ts`'s: a jittered self-rescheduling timeout, a cycle that
 * never overlaps itself (the next tick is booked only after this one settles), an unreferenced
 * timer, and a failed call that costs one call rather than the loop. Engine errors are logged and
 * swallowed; each run and each workspace gets at most one call per tick, and the calls of a tick
 * are made one after another, so there is never more than one in flight.
 *
 * **It logs only when it did something**, as every loop here does.
 */

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { AppConfigService } from "../config/config.service";
import { EngineClient } from "../engine/engine.client";
import { describeForLog } from "../errors/failure";
import { jittered } from "../scheduling/cadence";
import { RunExecutionRepository } from "./run-execution.repository";

/** How the timer names itself in `SchedulerRegistry`. */
export const RUN_SUPERVISOR_TIMEOUT = "run-supervisor";

/** What one tick did — for the log and for a test. */
export interface SupervisorTick {
  /** Stale runs the engine took. */
  readonly resubmitted: number;
  /** Stale runs the engine declined or could not be reached for. */
  readonly declined: number;
  /** Workspaces where the engine claimed and opened a run. */
  readonly claimed: number;
}

@Injectable()
export class RunSupervisor implements OnApplicationBootstrap, OnApplicationShutdown {
  /** Where a tick is reported. */
  private readonly logger = new Logger(RunSupervisor.name);

  /** Set once the application is shutting down, so a tick in flight books no further one. */
  private stopped = false;

  /**
   * @param runs - The two reads: stale runs, claimable workspaces.
   * @param engine - Where runs are resubmitted and claims asked for.
   * @param config - The cadence, the staleness and the live-execution switch.
   * @param scheduler - Nest's registry, where every scheduled thing in this process lives.
   */
  constructor(
    private readonly runs: RunExecutionRepository,
    private readonly engine: EngineClient,
    private readonly config: AppConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /** Start the loop once the application is up. The first delay is a full jittered interval. */
  onApplicationBootstrap(): void {
    this.schedule(this.interval());
  }

  /** Stop the loop, and clear a pending timer. */
  onApplicationShutdown(): void {
    this.stopped = true;

    if (this.scheduler.doesExist("timeout", RUN_SUPERVISOR_TIMEOUT)) {
      this.scheduler.deleteTimeout(RUN_SUPERVISOR_TIMEOUT);
    }
  }

  /**
   * Run one cycle and schedule the next, whatever the first did.
   *
   * Public so a test can drive a cycle without waiting for a timer.
   *
   * @returns When the cycle has settled and the next tick is booked.
   */
  async tick(): Promise<void> {
    if (this.scheduler.doesExist("timeout", RUN_SUPERVISOR_TIMEOUT)) {
      this.scheduler.deleteTimeout(RUN_SUPERVISOR_TIMEOUT);
    }

    try {
      const done = await this.supervise();

      if (done.resubmitted > 0 || done.claimed > 0) {
        this.logger.log(
          `Run supervisor: ${String(done.resubmitted)} stale run(s) resubmitted, ` +
            `${String(done.claimed)} workspace claim(s) opened a run.`,
        );
      }
    } catch (error) {
      // A cycle is lost, not the loop: a stale run is still stale next tick.
      this.logger.error("Run supervisor tick failed; retrying next tick.", describeForLog(error));
    }

    this.schedule(this.interval());
  }

  /**
   * One cycle's work: resubmit every stale run, then — while live execution is enabled — ask for
   * one claim per workspace with something claimable.
   *
   * @param now - The instant staleness and leases are measured from; injectable for tests.
   * @returns What the cycle did.
   */
  async supervise(now: Date = new Date()): Promise<SupervisorTick> {
    const staleBefore = new Date(now.getTime() - this.config.runHeartbeatStaleSeconds * 1000);
    const stale = await this.runs.staleRuns(staleBefore);
    let resubmitted = 0;
    let declined = 0;

    for (const run of new Set(stale)) {
      try {
        const answer = await this.engine.executeRun(run);

        if (answer.accepted) {
          resubmitted += 1;
        } else {
          declined += 1;
        }
      } catch (error) {
        declined += 1;
        this.logger.warn(
          `Run ${run} could not be resubmitted to the engine.`,
          describeForLog(error),
        );
      }
    }

    let claimed = 0;

    if (this.config.liveExecutionEnabled) {
      const workspaces = await this.runs.claimableWorkspaces(now);

      for (const workspace of new Set(workspaces)) {
        try {
          const answer = await this.engine.claimWork(workspace);

          if (answer.claimed) {
            claimed += 1;
          }
        } catch (error) {
          this.logger.warn(
            `The engine could not be asked to claim for workspace ${workspace}.`,
            describeForLog(error),
          );
        }
      }
    }

    return { resubmitted, declined, claimed };
  }

  /**
   * The nominal delay, jittered.
   *
   * @returns Milliseconds.
   */
  private interval(): number {
    return jittered(this.config.runSupervisorTickSeconds * 1000);
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

    timer.unref();

    this.scheduler.addTimeout(RUN_SUPERVISOR_TIMEOUT, timer);
  }
}
