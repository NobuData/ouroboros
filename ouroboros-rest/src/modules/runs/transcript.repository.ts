/**
 * The transcript retention sweep's statements (BQ.3,
 * [#482](https://github.com/NobuData/ouroboros/issues/482)).
 *
 * `run_events` is append-only for the application role (V046), so the removal itself is V101's
 * `run_events_sweep()` — a definer function that deletes one finished run's whole transcript and
 * stamps `runs.events_swept_at`. This file only chooses the runs and calls it.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import { cutoffOf, cutoffSql, type RetentionCutoffs } from "../retention/retention.cutoffs";

/** A finished run whose transcript is past its workspace's cutoff. */
export interface TranscriptCandidate {
  readonly id: string;
  readonly organization_id: string;
}

/** What one run's sweep removed. */
export interface TranscriptSwept {
  /** Transcript entries removed. */
  readonly events: number;
  /** Their body and payload bytes. */
  readonly bytes: number;
}

@Injectable()
export class TranscriptRetentionRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Finished runs, transcript still kept, that finished before their workspace's `transcripts`
   * cutoff — oldest first.
   *
   * @param cutoffs - The `transcripts` cutoffs, per workspace.
   * @param limit - The most runs.
   * @returns The runs.
   */
  async expired(cutoffs: RetentionCutoffs, limit: number): Promise<TranscriptCandidate[]> {
    const { rows } = await sql<TranscriptCandidate>`
      select run.id, run.organization_id
        from ouroboros.runs run
       where run.events_swept_at is null
         and run.finished_at is not null
         and run.finished_at < ${cutoffSql(cutoffs, "run.organization_id")}
       order by run.finished_at, run.id
       limit ${limit}`.execute(this.database.db);

    return rows;
  }

  /**
   * Remove one run's whole transcript and tombstone the run.
   *
   * @param candidate - The run.
   * @param cutoffs - The `transcripts` cutoffs — the function re-checks the run against its own.
   * @param at - The tombstone's time.
   * @returns What was removed, or `undefined` when the run is no longer sweepable (swept by a
   *   concurrent sweep, locked, or no longer past its cutoff).
   */
  async sweep(
    candidate: TranscriptCandidate,
    cutoffs: RetentionCutoffs,
    at: Date,
  ): Promise<TranscriptSwept | undefined> {
    const { rows } = await sql<{ events: number; bytes: string }>`
      select events, bytes
        from ouroboros.run_events_sweep(${candidate.organization_id}, ${candidate.id}::uuid,
                                        ${cutoffOf(cutoffs, candidate.organization_id)}::timestamptz,
                                        ${at}::timestamptz)`.execute(this.database.db);

    const row = rows.at(0);
    return row === undefined ? undefined : { events: row.events, bytes: Number(row.bytes) };
  }
}
