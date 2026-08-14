/**
 * Every statement this module issues against the workspace-settings pair (V011,
 * [#67](https://github.com/NobuData/ouroboros/issues/67)).
 *
 * Two statements, split exactly as V011 splits the schema: **read the view, write the
 * table.** `workspace_settings_effective` answers for a workspace that has never written a
 * settings row — the defaults are resolved in the database, so a newly created workspace
 * reads `auto_merge_on_checks = false` from the same place an opinionated one reads `true` —
 * and `workspace_settings` is where a choice lands when somebody makes one.
 *
 * The write is an upsert, and that upsert is the whole of the ticket's lazy-creation
 * criterion ([#74](https://github.com/NobuData/ouroboros/issues/74)): a row exists exactly
 * when a workspace has expressed a choice, "flip the switch" is the same request whether it
 * is the first flip or the fortieth, and the primary key lets the database arbitrate two
 * racing administrators instead of this code pretending to. The same shape
 * `preferences.repository.ts` keeps, at the workspace's scale rather than the person's.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { WorkspaceSettings, WorkspaceSettingsEffective } from "../db/schema";

@Injectable()
export class SettingsRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's
   *   lifecycle belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One workspace's settings, defaults resolved.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns Its row of the effective view — `is_explicit: false` and null stamps for a
   *   workspace that has never chosen — or `undefined` for a workspace the view has no row
   *   for at all. The tenant guard has already established the workspace exists, so the
   *   `undefined` is unreachable through the pipeline; the caller decides what it means,
   *   and `resources.ts` makes it the defaults for the same reason the view itself does.
   */
  async effective(organizationId: string): Promise<WorkspaceSettingsEffective | undefined> {
    return this.database.db
      .selectFrom("workspace_settings_effective")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();
  }

  /**
   * Record the switch's position, creating the settings row if this is the workspace's
   * first choice.
   *
   * `onConflict … doUpdateSet` rather than a read-then-write: the primary key makes the
   * conflict target exact, and `updated_at` moves by trigger either way — nothing here
   * names that column, so the server clock is its only writer.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param enabled - The switch's new position — already validated by the DTO.
   * @param updatedBy - Who flipped it: `"user".id`, from the session. Written on every
   *   upsert, because the attribution is the point of the column — a row whose value was
   *   re-affirmed by a different administrator is a row whose `updated_by` should say so.
   * @returns The row as stored, trigger stamps included.
   */
  async upsertAutoMerge(
    organizationId: string,
    enabled: boolean,
    updatedBy: string,
  ): Promise<WorkspaceSettings> {
    return this.database.db
      .insertInto("workspace_settings")
      .values({
        organization_id: organizationId,
        auto_merge_on_checks: enabled,
        updated_by: updatedBy,
      })
      .onConflict((conflict) =>
        conflict
          .column("organization_id")
          .doUpdateSet({ auto_merge_on_checks: enabled, updated_by: updatedBy }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
