/**
 * Every statement build-log ingest, retrieval and retention issue, in one class.
 *
 * AH.5 ([#253](https://github.com/NobuData/ouroboros/issues/253)). The table is V040's
 * `build_log_chunks`, and most of what makes it honest is already there: the cap trigger assigns
 * each chunk's `byte_start` from the job's running total, clamps the chunk that crosses the cap,
 * writes the marker on it, and counts everything refused after. What this file adds is the order
 * chunks arrive in (they are inserted in `seq` order by `log.ingest.ts`, so the trigger's offsets
 * are the stream's), where an elision is kept (V044's columns), and the sweep.
 *
 * ---------------------------------------------------------------------------
 * **No insert here uses `on conflict`.** The cap trigger is BEFORE INSERT and updates the job's
 * running total itself, so an `on conflict do nothing` that swallowed a re-sent `seq` would still
 * have advanced the total — and every later chunk's offset would sit past a gap that is not
 * there. A plain insert that collides raises, the whole statement rolls back — the trigger's
 * update with it — and {@link LogRepository.store} reports a duplicate.
 *
 * **A finished job's log is final.** Every write here is to a job that is still offered, accepted
 * or running, checked under the job's lock. The live card stops polling the moment a job reads as
 * finished, so a byte — or an elision — written after that would never be drawn; the agent's own
 * `job.finish` is accounted *before* the job is marked finished (`log.ingest.ts`), and anything
 * that arrives after is not written.
 *
 * **Tenancy.** `build_log_chunks` has no `organization_id` of its own; every chunk is reached
 * through its job, and every job is looked up with the workspace beside its id — the runner's,
 * from the connection's proven identity, on the ingest side, and the session's on the read side.
 * The retention sweep's reads are unscoped for the presence sweep's reason: fleet upkeep, each
 * row then acted on in its own workspace.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { BuildJobStatus } from "../../db/schema";
import { UNIQUE_VIOLATION, isDatabaseFailure } from "../../tenancy/constraints";
import { LOG_CHUNK_MAX_BYTES } from "../gateway/gateway.policy";
import type { StoredChunk } from "./log.slice";

/** A job a runner may write the log of. */
export interface WritableJob {
  readonly id: string;
  readonly organization_id: string;
}

/** A chunk to store, in `seq` order. */
export interface ChunkWrite {
  readonly seq: number;
  readonly content: Buffer;
  /** Bytes elided immediately before it — the agent's, plus any the rate guard refused. */
  readonly elidedBytes: number;
  /** Chunks immediately before it that never arrived. */
  readonly missingChunks: number;
  /** The agent's own `dropped_bytes` on this chunk, for the job's running total. */
  readonly agentDropped: number;
  /** When the retention sweep may remove it. */
  readonly retainUntil: Date;
}

/**
 * What storing a chunk did. `closed` is a job that finished while the chunk was on its way: its
 * log was final the moment it finished, so nothing more is written to it.
 */
export type Stored = "stored" | "past_cap" | "duplicate" | "closed";

/** The statuses a job's log is still open in — offered, accepted (`queued`) and running. */
const OPEN = ["offered", "queued", "running"] as const;

/** What a finish tells the log about its tail. */
export interface FinishedLog {
  /** `job.finish.log.dropped_bytes` — the agent's total, tail included. */
  readonly agentDropped: number;
  /** Chunks after the last that arrived that never did. */
  readonly missingChunks: number;
  /** Bytes the rate guard refused with no later chunk to carry them. */
  readonly refusedBytes: number;
}

/** The job a read is for, and the log's own totals. */
export interface LogJob {
  readonly status: BuildJobStatus;
  /** Bytes stored — the end of the stream as it stands. */
  readonly logBytes: number;
  /** Bytes elided after the last stored byte. */
  readonly droppedBytes: number;
  readonly missingChunks: number;
  readonly capBytes: number;
  readonly sweptAt: Date | null;
}

/** A job whose log the sweep may remove. */
export interface SweepCandidate {
  readonly id: string;
  readonly organization_id: string;
}

/** What removing one job's log removed. */
export interface Swept {
  readonly chunks: number;
  readonly bytes: number;
}

@Injectable()
export class LogRepository {
  /**
   * @param database - The typed connection. Injected, never constructed.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The job a runner may write the log of: one of its workspace's, dispatched to it, and not
   * finished.
   *
   * @param organizationId - The workspace, from the connection's identity.
   * @param runnerId - The runner, from the same.
   * @param jobId - The job the frame named.
   * @returns The job, or `undefined` for another runner's job, another workspace's, a finished
   *   one, or none.
   */
  async writableJob(
    organizationId: string,
    runnerId: string,
    jobId: string,
  ): Promise<WritableJob | undefined> {
    return this.database.db
      .selectFrom("build_jobs")
      .select(["id", "organization_id"])
      .where("organization_id", "=", organizationId)
      .where("id", "=", jobId)
      .where("runner_id", "=", runnerId)
      .where("status", "in", OPEN)
      .executeTakeFirst();
  }

  /**
   * The first `seq` a job has not stored — where its reassembly starts.
   *
   * @param jobId - The job, already checked to be the caller's.
   * @returns One past its highest stored `seq`, or 0.
   */
  async nextSeq(jobId: string): Promise<number> {
    const row = await this.database.db
      .selectFrom("build_log_chunks")
      .select(({ fn }) => fn.max<number>("seq").as("last"))
      .where("job_id", "=", jobId)
      .executeTakeFirst();

    return row?.last === null || row?.last === undefined ? 0 : row.last + 1;
  }

  /**
   * Store one chunk, in `seq` order, and count the agent's drops onto the job.
   *
   * The cap trigger decides what happens to the bytes: written whole, clamped with its marker,
   * or — past the cap — no row at all, only the job's dropped total moving. In that last case the
   * elision this chunk carried has nowhere to sit but the tail too, so it is added there.
   *
   * @param job - The job, already checked to be the caller's.
   * @param write - The chunk.
   * @returns What happened to it.
   */
  async store(job: WritableJob, write: ChunkWrite): Promise<Stored> {
    try {
      return await this.database.transaction(async (trx): Promise<Stored> => {
        // Locked, so a finish committing beside this store is either wholly before it or after.
        const open = await trx
          .selectFrom("build_jobs")
          .select("id")
          .where("organization_id", "=", job.organization_id)
          .where("id", "=", job.id)
          .where("status", "in", OPEN)
          .forUpdate()
          .executeTakeFirst();
        if (!open) return "closed";

        const row = await trx
          .insertInto("build_log_chunks")
          .values({
            job_id: job.id,
            seq: write.seq,
            content: write.content,
            elided_bytes: String(write.elidedBytes),
            missing_chunks: write.missingChunks,
            retain_until: write.retainUntil,
          })
          .returning("id")
          .executeTakeFirst();

        const pastCap = row === undefined;
        const tail = pastCap ? write.elidedBytes : 0;

        await trx
          .updateTable("build_jobs")
          .set({
            log_agent_dropped_bytes: sql<string>`log_agent_dropped_bytes + ${write.agentDropped}`,
            log_dropped_bytes: sql<string>`log_dropped_bytes + ${tail}`,
            log_missing_chunks: sql<number>`log_missing_chunks + ${pastCap ? write.missingChunks : 0}`,
            log_truncated_at: sql<Date | null>`case
              when log_dropped_bytes + ${tail} > 0 then coalesce(log_truncated_at, now())
              else log_truncated_at
            end`,
          })
          .where("organization_id", "=", job.organization_id)
          .where("id", "=", job.id)
          .execute();

        return pastCap ? "past_cap" : "stored";
      });
    } catch (cause) {
      if (
        isDatabaseFailure(cause) &&
        cause.code === UNIQUE_VIOLATION &&
        cause.constraint === "build_log_chunks_job_seq_key"
      ) {
        return "duplicate";
      }
      throw cause;
    }
  }

  /**
   * Count the agent's drops on a chunk the rate guard refused, so a finish can still tell its
   * tail from what was already placed.
   *
   * @param job - The job.
   * @param agentDropped - The refused chunk's own `dropped_bytes`.
   * @returns When it is counted.
   */
  async countAgentDrops(job: WritableJob, agentDropped: number): Promise<void> {
    if (agentDropped === 0) return;

    await this.database.db
      .updateTable("build_jobs")
      .set({ log_agent_dropped_bytes: sql<string>`log_agent_dropped_bytes + ${agentDropped}` })
      .where("organization_id", "=", job.organization_id)
      .where("id", "=", job.id)
      .where("status", "in", OPEN)
      .execute();
  }

  /**
   * Record what a `job.finish` says about the end of the log: the agent's tail drops — its total
   * less what it had already placed before a chunk — the rate guard's unplaced refusals, and the
   * frames that never arrived. All of it is the tail, one figure, so the console draws one marker.
   *
   * Called before the finish is recorded, and only while the job is still open, so a re-send of a
   * finish that was recorded changes nothing. The agent's part is idempotent by construction —
   * `greatest` against its running total — so a finish re-sent after a crash between this and the
   * ledger does not count it twice.
   *
   * @param job - The job, already checked to be the caller's.
   * @param finished - What the finish said, and what ingest still carried.
   * @returns When it is recorded.
   */
  async finish(job: WritableJob, finished: FinishedLog): Promise<void> {
    const tail = sql<string>`greatest(0, ${finished.agentDropped} - log_agent_dropped_bytes) + ${finished.refusedBytes}`;

    await this.database.db
      .updateTable("build_jobs")
      .set({
        log_dropped_bytes: sql<string>`log_dropped_bytes + ${tail}`,
        log_agent_dropped_bytes: sql<string>`greatest(log_agent_dropped_bytes, ${finished.agentDropped})`,
        log_missing_chunks: sql<number>`log_missing_chunks + ${finished.missingChunks}`,
        log_truncated_at: sql<Date | null>`case
          when log_dropped_bytes + ${tail} > 0 then coalesce(log_truncated_at, now())
          else log_truncated_at
        end`,
      })
      .where("organization_id", "=", job.organization_id)
      .where("id", "=", job.id)
      .where("status", "in", OPEN)
      .execute();
  }

  /**
   * The job a read is for, with the log's totals — scoped to the reader's workspace.
   *
   * @param organizationId - The workspace, from the session.
   * @param jobId - The job.
   * @returns The job, or `undefined` for none in this workspace.
   */
  async logJob(organizationId: string, jobId: string): Promise<LogJob | undefined> {
    const row = await this.database.db
      .selectFrom("build_jobs")
      .select([
        "status",
        "log_bytes",
        "log_dropped_bytes",
        "log_missing_chunks",
        "log_cap_bytes",
        "log_swept_at",
      ])
      .where("organization_id", "=", organizationId)
      .where("id", "=", jobId)
      .executeTakeFirst();

    if (!row) return undefined;

    return {
      status: row.status,
      logBytes: Number(row.log_bytes),
      droppedBytes: Number(row.log_dropped_bytes),
      missingChunks: row.log_missing_chunks,
      capBytes: Number(row.log_cap_bytes),
      sweptAt: row.log_swept_at,
    };
  }

  /**
   * The chunks a page starting at an offset is cut from.
   *
   * Reads `(job_id, byte_start)`'s unique index, bounded below by the largest chunk the gateway
   * accepts: a chunk that overlaps the offset starts at most one chunk before it.
   *
   * @param jobId - The job, already checked to be the reader's.
   * @param offset - Where the page starts.
   * @param maxBytes - How far it may reach.
   * @returns The overlapping chunks, in stream order.
   */
  async chunks(jobId: string, offset: number, maxBytes: number): Promise<StoredChunk[]> {
    const rows = await this.database.db
      .selectFrom("build_log_chunks")
      .select(["byte_start", "content", "elided_bytes", "missing_chunks"])
      .where("job_id", "=", jobId)
      .where("byte_start", ">=", String(Math.max(0, offset - LOG_CHUNK_MAX_BYTES)))
      .where("byte_start", "<", String(offset + maxBytes))
      .where(sql<boolean>`byte_start + octet_length(content) > ${offset}`)
      .orderBy("byte_start")
      .execute();

    return rows.map((row) => ({
      byteStart: Number(row.byte_start),
      content: row.content,
      elidedBytes: Number(row.elided_bytes),
      missingChunks: row.missing_chunks,
    }));
  }

  /**
   * Finished jobs whose every chunk is past its `retain_until` — the age rule.
   *
   * A job with some chunks still inside their window waits: a log is removed whole or not at all.
   *
   * @param now - The cutoff.
   * @param limit - The most jobs.
   * @returns The jobs.
   */
  async expired(now: Date, limit: number): Promise<SweepCandidate[]> {
    const { rows } = await sql<SweepCandidate>`
      select job.id, job.organization_id
        from ouroboros.build_jobs job
       where job.id in (select distinct chunk.job_id
                          from ouroboros.build_log_chunks chunk
                         where chunk.retain_until < ${now}
                         limit ${limit})
         and job.finished_at is not null
         and job.log_swept_at is null
         and not exists (select 1 from ouroboros.build_log_chunks kept
                          where kept.job_id = job.id and kept.retain_until >= ${now})`.execute(
      this.database.db,
    );

    return rows;
  }

  /**
   * The workspaces whose finished builds' logs are over a byte budget, and by how much.
   *
   * @param budget - Bytes per workspace.
   * @returns Each workspace over it, with its kept total.
   */
  async overBudget(budget: number): Promise<{ organizationId: string; kept: number }[]> {
    const { rows } = await sql<{ organization_id: string; kept: string }>`
      select organization_id, sum(log_bytes)::bigint as kept
        from ouroboros.build_jobs
       where log_swept_at is null and log_bytes > 0 and finished_at is not null
       group by organization_id
      having sum(log_bytes) > ${budget}`.execute(this.database.db);

    return rows.map((row) => ({ organizationId: row.organization_id, kept: Number(row.kept) }));
  }

  /**
   * A workspace's finished jobs that still hold a log, oldest first — the budget rule's order.
   *
   * @param organizationId - The workspace.
   * @param limit - The most jobs.
   * @returns The jobs, with how much each holds.
   */
  async oldestKept(
    organizationId: string,
    limit: number,
  ): Promise<(SweepCandidate & { bytes: number })[]> {
    const rows = await this.database.db
      .selectFrom("build_jobs")
      .select(["id", "organization_id", "log_bytes"])
      .where("organization_id", "=", organizationId)
      .where("log_swept_at", "is", null)
      .where("log_bytes", ">", "0")
      .where("finished_at", "is not", null)
      .orderBy("finished_at")
      .orderBy("id")
      .limit(limit)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      organization_id: row.organization_id,
      bytes: Number(row.log_bytes),
    }));
  }

  /**
   * Remove one finished job's log — all of it — and leave the tombstone.
   *
   * @param candidate - The job.
   * @param now - The tombstone's time.
   * @returns What was removed, or `undefined` when the job is no longer sweepable.
   */
  async sweep(candidate: SweepCandidate, now: Date): Promise<Swept | undefined> {
    return this.database.transaction(async (trx): Promise<Swept | undefined> => {
      const job = await trx
        .selectFrom("build_jobs")
        .select("id")
        .where("organization_id", "=", candidate.organization_id)
        .where("id", "=", candidate.id)
        .where("finished_at", "is not", null)
        .where("log_swept_at", "is", null)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();

      if (!job) return undefined;

      const removed = await trx
        .deleteFrom("build_log_chunks")
        .where("job_id", "=", job.id)
        .returning(sql<number>`octet_length(content)`.as("size"))
        .execute();

      await trx
        .updateTable("build_jobs")
        .set({ log_swept_at: now })
        .where("organization_id", "=", candidate.organization_id)
        .where("id", "=", job.id)
        .execute();

      return {
        chunks: removed.length,
        bytes: removed.reduce((sum, row) => sum + Number(row.size), 0),
      };
    });
  }
}
