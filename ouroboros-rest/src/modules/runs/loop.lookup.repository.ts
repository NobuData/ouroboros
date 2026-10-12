/**
 * A loop by the number people say — two reads, and no writes (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * `/ouro pause loop 1847` names a run the way mockup 10's head does: *Loop #1847*, which is
 * `runs.loop_seq`, unique per workspace (V044). Every route here addresses a run by its uuid, so
 * nothing could turn the number back into the row — and a chat command that guessed, or matched a
 * prefix, would pause the wrong loop. {@link LoopLookupRepository.byLoopSeq} is that one exact read.
 * {@link LoopLookupRepository.live} is the completion list: the active-runs listing carries no
 * `loop_seq`, and widening `RunSummary` for a hint would change the dashboard's payload.
 *
 * **It is exported, and it can only read.** `RunsModule` exports nothing else, for the reason its
 * header gives; this class is the exception because it holds no statement that changes a row, so
 * exporting it opens no path around `ControlsService` — the command still pauses through the same
 * service the run console's button does. `chatops/planes/boundary.spec.ts` holds it to that.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import { ACTIVE_RUN_STATUSES, type RunStatus } from "../db/schema";

/** A run, as a loop number resolves to it. */
export interface LoopRow {
  /** `runs.id` — what every control is addressed to. */
  readonly runId: string;
  /** `runs.loop_seq` — the number that was typed. */
  readonly loopSeq: number;
  readonly status: RunStatus;
  /** The issue the loop is working — `#482`. */
  readonly issueNumber: number;
  readonly issueTitle: string;
  /** When it stopped, or `null` for a loop still in flight. */
  readonly finishedAt: Date | null;
}

/** The columns both reads select. */
const LOOP_COLUMNS = [
  "id as runId",
  "loop_seq as loopSeq",
  "status",
  "issue_number as issueNumber",
  "issue_title as issueTitle",
  "finished_at as finishedAt",
] as const;

@Injectable()
export class LoopLookupRepository {
  /** @param database - The typed connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The workspace's run carrying this loop number, exactly.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param loopSeq - The number, already parsed as a positive integer.
   * @returns The run, or `undefined` — which covers "no such loop" and "another workspace's loop".
   */
  async byLoopSeq(organizationId: string, loopSeq: number): Promise<LoopRow | undefined> {
    return this.database.db
      .selectFrom("runs")
      .select(LOOP_COLUMNS)
      .where("organization_id", "=", organizationId)
      .where("loop_seq", "=", loopSeq)
      .executeTakeFirst();
  }

  /**
   * The loops in flight whose number starts with what has been typed, newest first.
   *
   * @param organizationId - The workspace.
   * @param prefix - The digits typed so far; empty for every live loop.
   * @param limit - The most to return.
   * @returns The live loops.
   */
  async live(organizationId: string, prefix: string, limit: number): Promise<LoopRow[]> {
    let query = this.database.db
      .selectFrom("runs")
      .select(LOOP_COLUMNS)
      .where("organization_id", "=", organizationId)
      .where("status", "in", [...ACTIVE_RUN_STATUSES]);

    if (prefix !== "") {
      query = query.where(sql<boolean>`loop_seq::text like ${`${prefix}%`}`);
    }

    return query.orderBy("loop_seq", "desc").limit(limit).execute();
  }
}
