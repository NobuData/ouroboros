/**
 * Build-log retention — the policy, written down, and the bounded sweep that applies it.
 *
 * AH.5 ([#253](https://github.com/NobuData/ouroboros/issues/253)), amended for BQ.3
 * ([#482](https://github.com/NobuData/ouroboros/issues/482)). Logs live in PostgreSQL (decision
 * **B8**), so a workspace's logs are disk every other workspace shares. The policy:
 *
 * | Rule | What is kept | Where it comes from |
 * |---|---|---|
 * | **Age** | a chunk until its `retain_until` — thirty days after it was stored | written onto each chunk at ingest, so a policy that changes later never reaches back into what was written under the old one (V040) |
 * | **Budget** | at most `OURO_FARM_LOG_BUDGET_BYTES` of finished builds' logs per workspace (2 GiB by default) | the oldest finished jobs' logs go first |
 *
 * Three rules hold for both:
 *
 *   * **Only a finished job's log is swept.** A running build's is what the live card is reading
 *     (V044's `build_jobs_log_swept_when_finished`).
 *   * **A log is removed whole, never in part**, and the job keeps a tombstone, `log_swept_at`, so
 *     the read API answers *removed by retention* rather than an empty log that looks like a quiet
 *     build. The age rule therefore waits until every chunk of a job is past its window.
 *   * **The sweep is bounded**: at most {@link LOG_SWEEP_BATCH} jobs per rule per run, every ten
 *     minutes, so a backlog is worked down a batch at a time and the sweep never becomes the load
 *     problem it exists to prevent. Every run that removed something logs its tombstone counts.
 *
 * **#482's seam.** The retention policy service (BQ.3) will govern per-class tiers from the
 * settings page, and build logs will read its `build_logs` tier. Until it exists the policy is the
 * {@link FARM_LOG_RETENTION} provider bound below — thirty days and the configured budget — which
 * #482 replaces with its own; its defaults reproduce these, so the switch deletes nothing
 * unexpected.
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { describeForLog } from "../../errors/failure";
import { jittered } from "../../scheduling/cadence";
import { GATEWAY_CLOCK, type GatewayClock } from "../gateway/gateway.clock";
import { LOG_SWEEP_BATCH, LOG_SWEEP_INTERVAL_MS } from "./log.policy";
import { LogRepository, type SweepCandidate } from "./log.repository";

/** The injection token for the retention policy — #482 binds its own. */
export const FARM_LOG_RETENTION = Symbol("FARM_LOG_RETENTION");

/** How the timer names itself in `SchedulerRegistry`. */
export const LOG_RETENTION_SWEEP = "farm-log-retention";

/** How long, and how much, build logs are kept. */
export interface LogRetentionPolicy {
  /** Days a chunk is kept after it is stored — its `retain_until`. */
  readonly days: number;
  /** Bytes of finished builds' logs one workspace keeps. */
  readonly budgetBytesPerOrg: number;
}

/** What one sweep removed — the tombstone counts. */
export interface SweepReport {
  /** Jobs whose log was removed by the age rule. */
  readonly byAge: number;
  /** Jobs whose log was removed by the budget rule. */
  readonly byBudget: number;
  readonly chunks: number;
  readonly bytes: number;
}

/** One day, in milliseconds. */
const DAY_MS = 86_400_000;

/**
 * When a chunk stored now may be swept.
 *
 * @param policy - The retention policy.
 * @param now - When it is stored.
 * @returns Its `retain_until`.
 */
export function retainUntil(policy: LogRetentionPolicy, now: Date): Date {
  return new Date(now.getTime() + policy.days * DAY_MS);
}

@Injectable()
export class LogRetentionSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(LogRetentionSweeper.name);
  private stopped = false;

  /**
   * @param repository - The sweep's statements.
   * @param policy - How long, and how much.
   * @param scheduler - Nest's registry, so the timer has a name.
   * @param now - The clock.
   */
  constructor(
    private readonly repository: LogRepository,
    @Inject(FARM_LOG_RETENTION) private readonly policy: LogRetentionPolicy,
    private readonly scheduler: SchedulerRegistry,
    @Inject(GATEWAY_CLOCK) private readonly now: GatewayClock,
  ) {}

  /** Start the loop. The first sweep is a full jittered interval away. */
  onApplicationBootstrap(): void {
    this.schedule();
  }

  /** Stop the loop, and clear a pending timer. */
  onApplicationShutdown(): void {
    this.stopped = true;

    if (this.scheduler.doesExist("timeout", LOG_RETENTION_SWEEP)) {
      this.scheduler.deleteTimeout(LOG_RETENTION_SWEEP);
    }
  }

  /**
   * One sweep, without the scheduling — what a suite drives. Age first, then budget, each bounded.
   *
   * @returns The tombstone counts.
   */
  async sweep(): Promise<SweepReport> {
    const at = this.now();
    let chunks = 0;
    let bytes = 0;

    const removeAll = async (candidates: SweepCandidate[]): Promise<number> => {
      let jobs = 0;
      for (const candidate of candidates) {
        const swept = await this.repository.sweep(candidate, at);
        if (!swept) continue;

        jobs += 1;
        chunks += swept.chunks;
        bytes += swept.bytes;
      }
      return jobs;
    };

    const byAge = await removeAll(await this.repository.expired(at, LOG_SWEEP_BATCH));

    let byBudget = 0;
    for (const workspace of await this.repository.overBudget(this.policy.budgetBytesPerOrg)) {
      if (byBudget >= LOG_SWEEP_BATCH) break;

      let excess = workspace.kept - this.policy.budgetBytesPerOrg;
      const oldest = await this.repository.oldestKept(
        workspace.organizationId,
        LOG_SWEEP_BATCH - byBudget,
      );
      const chosen: SweepCandidate[] = [];
      for (const job of oldest) {
        if (excess <= 0) break;
        chosen.push(job);
        excess -= job.bytes;
      }

      byBudget += await removeAll(chosen);
    }

    return { byAge, byBudget, chunks, bytes };
  }

  /** Run one sweep and book the next, whatever this one did. */
  private async tick(): Promise<void> {
    if (this.scheduler.doesExist("timeout", LOG_RETENTION_SWEEP)) {
      this.scheduler.deleteTimeout(LOG_RETENTION_SWEEP);
    }

    try {
      const report = await this.sweep();

      if (report.byAge > 0 || report.byBudget > 0) {
        this.logger.log(
          `Log retention: removed the logs of ${String(report.byAge + report.byBudget)} finished ` +
            `job(s) — ${String(report.byAge)} by age, ${String(report.byBudget)} by budget — ` +
            `${String(report.chunks)} chunk(s), ${String(report.bytes)} byte(s).`,
        );
      }
    } catch (error) {
      // A sweep is lost, not the loop: a process that stopped sweeping would let logs fill the
      // disk the budget exists to protect.
      this.logger.error("A log retention sweep failed; retrying next tick.", describeForLog(error));
    }

    this.schedule();
  }

  /** Book the next sweep, unless the application is going away. */
  private schedule(): void {
    if (this.stopped) return;

    const timer = setTimeout(() => {
      void this.tick();
    }, jittered(LOG_SWEEP_INTERVAL_MS));

    // The loop must not be the reason a process stays alive.
    timer.unref();

    this.scheduler.addTimeout(LOG_RETENTION_SWEEP, timer);
  }
}
