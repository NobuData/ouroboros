/**
 * The Backlog Health card's statements — three meters over the canonical backlog, and the nightly
 * job's last run.
 *
 * AL.5 ([#281](https://github.com/NobuData/ouroboros/issues/281)), decision **N9**: *backlog health =
 * computed metrics over canonical tickets*. Nothing here is stored: every read counts the rows as
 * they are, so a ticket a sync just closed, or a blocker that just resolved, moves the meter on the
 * next read with no counter anywhere to go stale.
 *
 * ## One statement for the three meters
 *
 * `count(*) filter (where …)` over the workspace's open tickets, in one pass, for
 * `estimation.repository.ts`'s `backlogCounts` reason: `38/42 · 4 · 6` has to describe one instant,
 * and four reads cannot promise that.
 *
 * ## What *blocked* means
 *
 * An open ticket is blocked when at least one `ticket_dependencies` edge names it as the blocked end
 * and that edge's blocker is **unresolved**:
 *
 *   * a **ticket** blocker that is still `open` — a closed blocker is done, so `#550`, blocked only
 *     by the closed `#545`, is not blocked;
 *   * a **draft** blocker in a batch that has not been abandoned — work that is planned but not yet
 *     in any tracker is not done either, and a push rewrites the edge to the ticket it became.
 *
 * **Both origins count** — `planned` edges authored on the planning page and `synced` ones mirrored
 * from a tracker's own relations — because a ticket blocked by a link somebody made in GitHub is
 * exactly as blocked. And a ticket blocked twice counts once: the predicate is `exists`, not a join.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { ReestimationRunStatus } from "../db/schema";

/** The three meters and the card's tag, as counted. */
export interface BacklogMetricsRow {
  /** Open tickets. */
  readonly open: number;
  /** Open tickets whose `sizing_status` is `sized`. */
  readonly sized: number;
  /** Open tickets with an unresolved blocker. */
  readonly blocked: number;
  /** Open tickets whose tracker last updated them before the threshold. */
  readonly stale: number;
}

/** The latest nightly run, with this workspace's counts from it. */
export interface LastRunRow {
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly status: ReestimationRunStatus;
  readonly found: number;
  readonly queued: number;
  readonly inFlight: number;
}

@Injectable()
export class BacklogHealthRepository {
  /**
   * @param database - The typed connection.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Count the card's meters for one workspace.
   *
   * @param organizationId - The workspace. Every table the statement reads is held to it.
   * @param staleBefore - A ticket whose `source_updated_at` is earlier than this is stale. The
   *   caller computes it from `OURO_BACKLOG_STALE_DAYS` against its own clock, so a spec can state
   *   the boundary rather than wait for it.
   * @returns The counts. A workspace with no tickets answers zeros — `0 of 0 sized` is a true
   *   statement, not a missing one.
   */
  async metrics(organizationId: string, staleBefore: Date): Promise<BacklogMetricsRow> {
    const row = await this.database.db
      .selectFrom("tickets as t")
      .select(({ fn, eb }) => [
        fn.countAll<string>().as("open"),
        fn
          .countAll<string>()
          .filterWhere(eb("t.sizing_status", "=", "sized"))
          .as("sized"),
        fn
          .countAll<string>()
          .filterWhere(
            eb.exists(
              eb
                .selectFrom("ticket_dependencies as d")
                .leftJoin("tickets as blocker", "blocker.id", "d.blocker_ticket_id")
                .leftJoin("ticket_drafts as draft", "draft.id", "d.blocker_draft_id")
                .leftJoin("draft_batches as batch", "batch.id", "draft.batch_id")
                .select(sql.lit(1).as("one"))
                .whereRef("d.blocked_ticket_id", "=", "t.id")
                .where("d.organization_id", "=", organizationId)
                .where((edge) =>
                  edge.or([
                    edge("blocker.state", "=", "open"),
                    edge.and([
                      edge("d.blocker_draft_id", "is not", null),
                      edge("batch.status", "!=", "abandoned"),
                    ]),
                  ]),
                ),
            ),
          )
          .as("blocked"),
        fn
          .countAll<string>()
          .filterWhere(eb("t.source_updated_at", "<", staleBefore))
          .as("stale"),
      ])
      .where("t.organization_id", "=", organizationId)
      .where("t.state", "=", "open")
      .executeTakeFirst();

    // `count()` is a bigint, which `pg` hands back as a string; a backlog fits a number.
    return {
      open: Number(row?.open ?? 0),
      sized: Number(row?.sized ?? 0),
      blocked: Number(row?.blocked ?? 0),
      stale: Number(row?.stale ?? 0),
    };
  }

  /**
   * The latest nightly re-estimation run, with **this** workspace's counts from it.
   *
   * The run is deployment-wide and any workspace may read when it happened; the counts are
   * workspace data and are joined on the workspace, so another workspace's backlog is never read.
   *
   * @param organizationId - The workspace.
   * @returns The run, with zero counts when it found nothing here — or `undefined` before the job
   *   has ever run.
   */
  async lastRun(organizationId: string): Promise<LastRunRow | undefined> {
    const row = await this.database.db
      .selectFrom("reestimation_runs as r")
      .leftJoin("reestimation_run_counts as c", (join) =>
        join.onRef("c.run_id", "=", "r.id").on("c.organization_id", "=", organizationId),
      )
      .select([
        "r.started_at as startedAt",
        "r.finished_at as finishedAt",
        "r.status as status",
        "c.found as found",
        "c.queued as queued",
        "c.in_flight as inFlight",
      ])
      .orderBy("r.started_at", "desc")
      .limit(1)
      .executeTakeFirst();

    if (row === undefined) {
      return undefined;
    }

    return {
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      status: row.status,
      found: row.found ?? 0,
      queued: row.queued ?? 0,
      inFlight: row.inFlight ?? 0,
    };
  }
}
