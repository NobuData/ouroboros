/**
 * The audit purge's statements (BR.2, [#486](https://github.com/NobuData/ouroboros/issues/486)).
 *
 * `audit_events` grants the application role no `delete` (V022), so the removal itself is V102's
 * `audit_events_purge()` — a definer function that deletes at most a batch of one workspace's
 * events older than a cutoff, refuses a cutoff inside the 90-day floor, and holds back events
 * another table still references. This file only names the workspaces and calls it.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";

/** What one batch of one workspace's purge did. */
export interface AuditPurgeBatch {
  /** Events deleted. */
  readonly removed: number;
  /** Events past the cutoff kept because another table references them. */
  readonly held: number;
}

@Injectable()
export class AuditPurgeRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every workspace — the purge asks each one, since each may store its own tier.
   *
   * @returns Their ids.
   */
  async organizations(): Promise<string[]> {
    const rows = await this.database.db.selectFrom("organization").select("id").execute();
    return rows.map((row) => row.id);
  }

  /**
   * Remove one batch of a workspace's expired events.
   *
   * @param organizationId - The workspace.
   * @param cutoff - Events that occurred before this are expired. At least 90 days ago, or the
   *   function refuses.
   * @param limit - The most to delete in this call.
   * @returns What was removed, and what is held.
   */
  async purge(organizationId: string, cutoff: Date, limit: number): Promise<AuditPurgeBatch> {
    const { rows } = await sql<{ removed: number; held: number }>`
      select removed, held
        from ouroboros.audit_events_purge(${organizationId}, ${cutoff}::timestamptz,
                                          ${limit}::integer)`.execute(this.database.db);

    const row = rows.at(0);
    return { removed: row?.removed ?? 0, held: row?.held ?? 0 };
  }
}
