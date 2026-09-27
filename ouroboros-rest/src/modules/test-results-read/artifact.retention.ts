/**
 * Artifact retention — the sweep that removes an expired artifact's bytes and leaves its row as a
 * tombstone (AT.5, [#333](https://github.com/NobuData/ouroboros/issues/333); amended for BQ.3,
 * [#482](https://github.com/NobuData/ouroboros/issues/482)).
 *
 * ```
 * every hour (jittered) ─▶ live rows past retained_until, this driver's, oldest first, ≤ 200
 *   each ─▶ ArtifactStore.delete(key) ─▶ expired_at = now   (name, kind, size stay)
 *        ─▶ the card renders `expired`, and GET /artifacts/:id answers 410
 * ```
 *
 * **The policy is on the row.** The upload writes `retained_until` from the workspace's policy —
 * thirty days by default, `OURO_ARTIFACT_RETENTION_DAYS` — so a file is kept as long as the policy
 * it was uploaded under said, and a later change never reaches back into what was already
 * promised. The sweep reads nothing but `retained_until`, which is why it honours per-workspace
 * policy without knowing any. **#482's seam** is that write: its retention policy service
 * computes the `artifacts` tier's cutoff centrally, and its defaults reproduce these thirty days.
 *
 * **Bytes first, then the tombstone.** A delete that fails leaves the row live, to be tried
 * again next tick; a tombstone that fails after the delete is written next tick too, because
 * deleting a missing object is not an error. The reverse order could mark a file expired whose
 * bytes were never removed.
 *
 * **Bounded, and observable.** At most {@link ARTIFACT_SWEEP_BATCH} rows a tick, and every tick
 * that removed something logs its tombstone counts, so a retention change is visible.
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
import type { ArtifactStore } from "../farm/artifacts/artifact.store";
import { ARTIFACT_STORE } from "../farm/artifacts/artifact.store.factory";
import { jittered } from "../scheduling/cadence";
import { ResultsRepository } from "./results.repository";
import { storedKey } from "./results.service";

/** How the timer names itself in `SchedulerRegistry`. */
export const ARTIFACT_RETENTION_SWEEP = "artifact-retention";

/** How often the sweep runs, before jitter — hourly. Retention is counted in days. */
export const ARTIFACT_SWEEP_INTERVAL_MS = 3_600_000;

/** The most artifacts one tick expires. A backlog is worked down a batch at a time. */
export const ARTIFACT_SWEEP_BATCH = 200;

/** What one sweep did — the tombstone counts. */
export interface ArtifactSweepReport {
  /** Artifacts tombstoned by this sweep. */
  readonly expired: number;
  /** Their bytes, as uploaded. */
  readonly bytes: number;
  /** Artifacts whose bytes could not be removed; they stay live and are retried. */
  readonly failed: number;
}

@Injectable()
export class ArtifactRetentionSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ArtifactRetentionSweeper.name);
  private stopped = false;

  /**
   * @param results - The sweep's statements.
   * @param store - The configured store — the one whose bytes this sweep may remove.
   * @param scheduler - Nest's registry, so the timer has a name.
   */
  constructor(
    private readonly results: ResultsRepository,
    @Inject(ARTIFACT_STORE) private readonly store: ArtifactStore,
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

    if (this.scheduler.doesExist("timeout", ARTIFACT_RETENTION_SWEEP)) {
      this.scheduler.deleteTimeout(ARTIFACT_RETENTION_SWEEP);
    }
  }

  /**
   * One sweep, without the scheduling — what a suite drives.
   *
   * @returns The tombstone counts.
   */
  async sweep(): Promise<ArtifactSweepReport> {
    const at = this.now();
    let expired = 0;
    let bytes = 0;
    let failed = 0;

    for (const artifact of await this.results.expiring(
      at,
      this.store.driver,
      ARTIFACT_SWEEP_BATCH,
    )) {
      const key = storedKey(artifact.storage_ref, this.store.driver);

      try {
        // The batch is this driver's, so a key is always there; a row without one has no bytes
        // this process could remove, and its tombstone is all that is left to write.
        if (key !== null) await this.store.delete(key);
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Artifact retention: the bytes of ${artifact.id} could not be removed; retrying next tick.`,
          describeForLog(error),
        );
        continue;
      }

      if (await this.results.markExpired(artifact, at)) {
        expired += 1;
        bytes += Number(artifact.size_bytes);
      }
    }

    return { expired, bytes, failed };
  }

  /** Run one sweep and book the next, whatever this one did. */
  private async tick(): Promise<void> {
    if (this.scheduler.doesExist("timeout", ARTIFACT_RETENTION_SWEEP)) {
      this.scheduler.deleteTimeout(ARTIFACT_RETENTION_SWEEP);
    }

    try {
      const report = await this.sweep();

      if (report.expired > 0 || report.failed > 0) {
        this.logger.log(
          `Artifact retention: tombstoned ${String(report.expired)} artifact(s), ` +
            `${String(report.bytes)} byte(s); ${String(report.failed)} could not be removed.`,
        );
      }
    } catch (error) {
      // A sweep is lost, not the loop: a process that stopped sweeping would keep every file.
      this.logger.error(
        "An artifact retention sweep failed; retrying next tick.",
        describeForLog(error),
      );
    }

    this.schedule();
  }

  /** Book the next sweep, unless the application is going away. */
  private schedule(): void {
    if (this.stopped) return;

    const timer = setTimeout(() => {
      void this.tick();
    }, jittered(ARTIFACT_SWEEP_INTERVAL_MS));

    // The loop must not be the reason a process stays alive.
    timer.unref();

    this.scheduler.addTimeout(ARTIFACT_RETENTION_SWEEP, timer);
  }
}
