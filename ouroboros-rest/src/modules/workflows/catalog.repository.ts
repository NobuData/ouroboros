/**
 * The stage catalog's one statement — the workspace's task kinds — R.3
 * ([#145](https://github.com/NobuData/ouroboros/issues/145)).
 *
 * The catalog's task-route suggestions are **registry data**, per the amendment decision
 * **M3** filed on the ticket: *"the DSL, this catalog and the routing matrix must not be able
 * to disagree about which task kinds exist."* So they are `task_kinds` (V016, #190) — the
 * rows the routing matrix draws — in the matrix's own order, and not a list in configuration.
 *
 * A statement here rather than an import of `RoutingModule`, whose repository reads the same
 * table: that module exports only its resolution service, and importing it would pull the
 * provider-health sweep into every consumer of the workflow registry for the sake of one
 * `select`.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";

@Injectable()
export class WorkflowCatalogRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The names of one workspace's task kinds, in the order the routing matrix draws them.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The names, `sort_order` ascending. Empty for a workspace whose routing foundations
   *   have not been seeded — nothing to suggest, not a failure.
   */
  async taskKindNames(organizationId: string): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom("task_kinds")
      .select("name")
      .where("organization_id", "=", organizationId)
      .orderBy("sort_order")
      .execute();

    return rows.map((row) => row.name);
  }
}
