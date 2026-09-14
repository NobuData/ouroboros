/**
 * The snapshot read — one statement, and it only reads
 * ([#589](https://github.com/NobuData/ouroboros/issues/589)).
 *
 * **Latest is V024's index, used as written.** `chain @> '[{"alias": "coder-max"}]'` is the
 * containment `resolution_snapshots_chain_idx` (GIN, `jsonb_path_ops`) was built for, and
 * `order by resolved_at desc, id desc` is `resolution_snapshots_organization_resolved_at_idx`'s
 * order — `id` breaks a tie between two resolutions in one millisecond, so *latest* is one row
 * rather than whichever the planner met first.
 *
 * **Any hop counts, kept or dropped.** A card asked about `coder-fallback` shows the last run in
 * which it was *in the chain*, including the run that dropped it: an alias that has been skipped
 * for a week is exactly what somebody inspecting it needs to see, and filtering to kept hops would
 * hide it behind an older success.
 *
 * **The shape version is pinned in the statement.** A reader pins the version it can read (V024's
 * header); a row in a shape this build does not know is not the latest *readable* snapshot, so it
 * is not an answer.
 *
 * **The run is joined within the workspace** — `r.organization_id = s.organization_id` — although
 * V024's trigger already holds a snapshot's run to its workspace, for `registry.repository.ts`'s
 * reason: a lookup that *could* cross a workspace boundary is one that eventually does.
 */

import { Injectable } from "@nestjs/common";
import { sql, type SqlBool } from "kysely";

import { DatabaseService } from "../db/db.service";
import { RESOLUTION_SNAPSHOT_SHAPE_VERSION } from "../routing/snapshot";
import type { ResolutionSnapshotRow } from "./resolutions.rows";

@Injectable()
export class ResolutionSnapshotsRepository {
  /**
   * @param database - The typed connection. Injected, never constructed.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The most recent snapshot in one workspace whose chain names an alias.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param alias - The alias's name, already validated as one.
   * @returns The snapshot with its run number, or `undefined` when no run in this workspace has
   *   resolved through the alias — the ordinary state until an executor writes one.
   */
  async latestNaming(
    organizationId: string,
    alias: string,
  ): Promise<ResolutionSnapshotRow | undefined> {
    return this.database.db
      .selectFrom("resolution_snapshots as s")
      .innerJoin("runs as r", (join) =>
        join.onRef("r.id", "=", "s.run_id").onRef("r.organization_id", "=", "s.organization_id"),
      )
      .select([
        "s.id",
        "s.run_id",
        "r.issue_number",
        "s.shape_version",
        "s.task_kind",
        "s.route_tag",
        "s.outcome",
        "s.duration_ms",
        "s.chain",
        "s.rules",
        "s.resolved_at",
      ])
      .where("s.organization_id", "=", organizationId)
      .where("s.shape_version", "=", RESOLUTION_SNAPSHOT_SHAPE_VERSION)
      .where(sql<SqlBool>`${sql.ref("s.chain")} @> ${JSON.stringify([{ alias }])}::jsonb`)
      .orderBy("s.resolved_at", "desc")
      .orderBy("s.id", "desc")
      .limit(1)
      .executeTakeFirst();
  }
}
