/**
 * The nightly re-estimation job's statements — claim the night, choose the batch, record the run.
 *
 * AL.5 ([#281](https://github.com/NobuData/ouroboros/issues/281)), decision **N9**.
 *
 * ## Unscoped reads, for `estimation.repository.ts`'s reason
 *
 * The caller is a timer and the work is every workspace's unsized backlog, so the batch read takes
 * no workspace. Each id travels with the workspace it belongs to, and that is what the per-workspace
 * counts are keyed by — no count of one workspace's backlog is ever written under another's.
 *
 * ## The batch is shared out across workspaces
 *
 * `row_number() over (partition by organization_id …)` ranks each workspace's unsized tickets, and
 * the batch is taken **rank first**: every workspace's oldest unsized ticket, then every workspace's
 * second, and so on until the bound. Ordered by age alone, one workspace with a thousand-ticket
 * import would spend every night's batch and a workspace with four unsized tickets would wait until
 * the import was sized.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";

/** One ticket the night's batch selected. */
export interface UnsizedTicketRow {
  /** `tickets.id`. */
  readonly ticketId: string;
  /** Its workspace — what the run's counts are keyed by. */
  readonly organizationId: string;
}

/** What one run did in one workspace. */
export interface RunCounts {
  readonly organizationId: string;
  /** Tickets the batch selected here. */
  readonly found: number;
  /** How many were queued. */
  readonly queued: number;
  /** How many the orchestrator was already sizing. */
  readonly inFlight: number;
}

@Injectable()
export class ReestimationRepository {
  /**
   * @param database - The typed connection.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Claim a night for this process.
   *
   * `insert … on conflict (night) do nothing returning id`: the first replica to start a night gets
   * the id, and every later one gets nothing and stands down. That is V039's
   * `reestimation_runs_night_key`, and it is what stops a fleet multiplying the batch bound.
   *
   * @param night - The slot's UTC date, `YYYY-MM-DD`.
   * @param batchLimit - The bound this run works under, recorded with it.
   * @returns The run's id, or `undefined` when another process has already run this night.
   */
  async startRun(night: string, batchLimit: number): Promise<string | undefined> {
    const row = await this.database.db
      .insertInto("reestimation_runs")
      .values({ night, batch_limit: batchLimit })
      .onConflict((conflict) => conflict.column("night").doNothing())
      .returning("id")
      .executeTakeFirst();

    return row?.id;
  }

  /**
   * The night's batch: open, unsized tickets across every workspace, shared out rank first.
   *
   * @param limit - The batch bound — the most rows this returns, whatever the backlog holds.
   * @returns At most `limit` tickets. Within a rank, oldest first.
   */
  async unsizedTickets(limit: number): Promise<UnsizedTicketRow[]> {
    const ranked = this.database.db
      .selectFrom("tickets")
      .select([
        "id",
        "organization_id",
        "source_created_at",
        sql<number>`row_number() over (partition by ${sql.ref("organization_id")} order by ${sql.ref(
          "source_created_at",
        )}, ${sql.ref("id")})`.as("rank"),
      ])
      .where("state", "=", "open")
      .where("sizing_status", "=", "unsized")
      .as("ranked");

    const rows = await this.database.db
      .selectFrom(ranked)
      .select(["ranked.id as ticketId", "ranked.organization_id as organizationId"])
      .orderBy("ranked.rank")
      .orderBy("ranked.source_created_at")
      .orderBy("ranked.id")
      .limit(limit)
      .execute();

    return rows;
  }

  /**
   * Settle a run and record what it did, in one transaction.
   *
   * @param runId - The id {@link startRun} returned.
   * @param status - `succeeded` once the batch is queued, `failed` when the run could not do that.
   * @param counts - One entry per workspace the batch touched; empty for a run that found nothing
   *   or failed before it could count.
   * @returns When the run is recorded.
   */
  async finishRun(
    runId: string,
    status: "succeeded" | "failed",
    counts: readonly RunCounts[],
  ): Promise<void> {
    await this.database.transaction(async (trx) => {
      if (counts.length > 0) {
        await trx
          .insertInto("reestimation_run_counts")
          .values(
            counts.map((count) => ({
              run_id: runId,
              organization_id: count.organizationId,
              found: count.found,
              queued: count.queued,
              in_flight: count.inFlight,
            })),
          )
          .execute();
      }

      await trx
        .updateTable("reestimation_runs")
        // The database's clock rather than this process's, so V039's `finished_after_started`
        // compares two readings of one clock — a replica running a few seconds behind the database
        // would otherwise record a run that finished before it started.
        .set({ status, finished_at: sql<Date>`now()` })
        .where("id", "=", runId)
        .execute();
    });
  }
}
