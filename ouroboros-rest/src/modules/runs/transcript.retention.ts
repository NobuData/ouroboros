/**
 * Transcript retention — the sweep the workspace card's *transcripts* promise needed (BQ.3,
 * [#482](https://github.com/NobuData/ouroboros/issues/482), amending AO.2,
 * [#299](https://github.com/NobuData/ouroboros/issues/299)).
 *
 * ```
 * every hour (jittered) ─▶ finished runs, transcript kept, finished before their workspace's
 *                          `transcripts` cutoff, oldest first, ≤ 200
 *   each ─▶ run_events_sweep(): every entry removed, runs.events_swept_at = now
 * ```
 *
 * **Whole transcripts of finished runs only.** A live run's transcript is what the console is
 * reading, and a transcript with a hole in it that looks seamless is worse than none; the run
 * keeps a tombstone (`events_swept_at`) so a reader can say *removed by retention*.
 *
 * **The cutoff is the policy service's**: `now − transcripts tier`, thirty days by default. The
 * database function re-checks it against the 7-day floor, so no computed cutoff can reach inside
 * the window the policy guarantees.
 *
 * **Bounded, and observable.** At most {@link TRANSCRIPT_SWEEP_BATCH} runs a tick, and every tick
 * that removed something logs its tombstone counts and reports them to `RetentionSchedule`.
 */

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { describeForLog } from "../errors/failure";
import { RetentionSchedule } from "../retention/retention.schedule";
import { RetentionPolicyService } from "../retention/retention.service";
import { jittered } from "../scheduling/cadence";
import { TranscriptRetentionRepository } from "./transcript.repository";

/** How the timer names itself in `SchedulerRegistry`. */
export const TRANSCRIPT_RETENTION_SWEEP = "transcript-retention";

/** How often the sweep runs, before jitter — hourly. Retention is counted in days. */
export const TRANSCRIPT_SWEEP_INTERVAL_MS = 3_600_000;

/** The most runs one tick sweeps the transcript of. A backlog is worked down a batch at a time. */
export const TRANSCRIPT_SWEEP_BATCH = 200;

/** What one sweep did — the tombstone counts. */
export interface TranscriptSweepReport {
  /** Runs whose transcript was removed. */
  readonly runs: number;
  /** Transcript entries removed. */
  readonly events: number;
  /** Their body and payload bytes. */
  readonly bytes: number;
}

@Injectable()
export class TranscriptRetentionSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TranscriptRetentionSweeper.name);
  private stopped = false;

  /**
   * @param repository - The sweep's statements.
   * @param retention - The `transcripts` tier's cutoffs.
   * @param retentionSchedule - Where the next sweep and the tombstone counts are reported.
   * @param scheduler - Nest's registry, so the timer has a name.
   */
  constructor(
    private readonly repository: TranscriptRetentionRepository,
    private readonly retention: RetentionPolicyService,
    private readonly retentionSchedule: RetentionSchedule,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /**
   * The current instant — a method so a spec can pin it.
   *
   * @returns Now.
   */
  now(): Date {
    return new Date();
  }

  /** Start the loop. The first sweep is a full jittered interval away. */
  onApplicationBootstrap(): void {
    this.schedule();
  }

  /** Stop the loop, and clear a pending timer. */
  onApplicationShutdown(): void {
    this.stopped = true;
    this.retentionSchedule.stopped("transcripts");

    if (this.scheduler.doesExist("timeout", TRANSCRIPT_RETENTION_SWEEP)) {
      this.scheduler.deleteTimeout(TRANSCRIPT_RETENTION_SWEEP);
    }
  }

  /**
   * One sweep, without the scheduling — what a suite drives.
   *
   * @returns The tombstone counts.
   */
  async sweep(): Promise<TranscriptSweepReport> {
    const at = this.now();
    const cutoffs = await this.retention.cutoffs("transcripts", at);
    let runs = 0;
    let events = 0;
    let bytes = 0;

    for (const candidate of await this.repository.expired(cutoffs, TRANSCRIPT_SWEEP_BATCH)) {
      const swept = await this.repository.sweep(candidate, cutoffs, at);
      if (swept === undefined) continue;

      runs += 1;
      events += swept.events;
      bytes += swept.bytes;
    }

    return { runs, events, bytes };
  }

  /** Run one sweep and book the next, whatever this one did. */
  private async tick(): Promise<void> {
    if (this.scheduler.doesExist("timeout", TRANSCRIPT_RETENTION_SWEEP)) {
      this.scheduler.deleteTimeout(TRANSCRIPT_RETENTION_SWEEP);
    }

    try {
      const report = await this.sweep();
      this.retentionSchedule.swept("transcripts", this.now(), report.runs);

      if (report.runs > 0) {
        this.logger.log(
          `Transcript retention: removed the transcripts of ${String(report.runs)} finished ` +
            `run(s) — ${String(report.events)} entr(ies), ${String(report.bytes)} byte(s).`,
        );
      }
    } catch (error) {
      // A sweep is lost, not the loop: a process that stopped sweeping would keep every transcript.
      this.logger.error(
        "A transcript retention sweep failed; retrying next tick.",
        describeForLog(error),
      );
    }

    this.schedule();
  }

  /** Book the next sweep, unless the application is going away. */
  private schedule(): void {
    if (this.stopped) return;

    const delay = jittered(TRANSCRIPT_SWEEP_INTERVAL_MS);
    const timer = setTimeout(() => {
      void this.tick();
    }, delay);
    this.retentionSchedule.booked("transcripts", new Date(Date.now() + delay));

    // The loop must not be the reason a process stays alive.
    timer.unref();

    this.scheduler.addTimeout(TRANSCRIPT_RETENTION_SWEEP, timer);
  }
}
