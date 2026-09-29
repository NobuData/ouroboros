/**
 * The statements behind step 3's template tiles and their instantiation
 * ([#386](https://github.com/NobuData/ouroboros/issues/386), BB.3).
 *
 * ```
 * mergedLoops           the runs read-model's merged count      merged_loop_count(org)       (V068)
 * templates / template  the tiles, with the unlock evaluated    workflow_templates_for(org)  (V068)
 * instantiatedWorkflows the workspace's workflows that carry template provenance
 * ```
 *
 * **The lock is evaluated where it is defined.** V068 ships the rule's evaluation as two SQL
 * functions — `workflow_template_unlock_threshold` and `workflow_template_unlocked` — and these
 * statements call them rather than restating the rule in TypeScript, so the tile, the ci probes
 * and any other reader share one answer. The operator's override (`OURO_ONBOARDING_UNLOCK_THRESHOLD`)
 * is passed straight to them.
 *
 * Nothing here writes: the one write instantiation makes goes through `WorkflowsService`, the
 * same door the studio publishes through.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";

/** A template tile the workspace is offered, with its unlock rule evaluated. */
export interface TemplateTileRow {
  slug: string;
  version: number;
  organization_id: string | null;
  name: string;
  description: string;
  stage_dots: unknown;
  effort_range: string[];
  caption: string | null;
  tier: string;
  definition: unknown;
  /** The threshold in force — the override, else the rule's `merged_loops_gte`; null for a starter. */
  threshold: number | null;
  /** `workflow_template_unlocked` — always true for a starter tile. */
  unlocked: boolean;
}

/** A workflow of the workspace instantiated from a template (V068 provenance). */
export interface InstantiatedWorkflowRow {
  id: string;
  slug: string;
  name: string;
  current_version: number | null;
  template_slug: string;
  template_version: number;
}

@Injectable()
export class TemplateTilesRepository {
  /**
   * @param database - The typed connection, injected.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The workspace's merged loops — runs whose status is `merged`, off the runs read-model.
   *
   * @param organizationId - The workspace.
   * @returns The count.
   */
  async mergedLoops(organizationId: string): Promise<number> {
    const { rows } = await sql<{ merged: string | number }>`
      select ouroboros.merged_loop_count(${organizationId}) as merged`.execute(this.database.db);

    return Number(rows[0]?.merged ?? 0);
  }

  /**
   * Every template the workspace is offered, in tile order, with the unlock rule evaluated.
   *
   * @param organizationId - The workspace.
   * @param mergedLoops - The count {@link mergedLoops} read, so one answer uses one count.
   * @param thresholdOverride - The operator's configured threshold, or undefined for none.
   * @returns One row per slug — an organization's own row shadowing the global one.
   */
  async templates(
    organizationId: string,
    mergedLoops: number,
    thresholdOverride: number | undefined,
  ): Promise<TemplateTileRow[]> {
    const override = thresholdOverride ?? null;
    const { rows } = await sql<TemplateTileRow>`
      select t.slug, t.version, t.organization_id, t.name, t.description, t.stage_dots,
             t.effort_range, t.caption, t.tier, t.definition,
             ouroboros.workflow_template_unlock_threshold(t.unlock_rule, ${override}::integer)
               as threshold,
             ouroboros.workflow_template_unlocked(t.unlock_rule, ${mergedLoops}::bigint,
                                                  ${override}::integer) as unlocked
        from ouroboros.workflow_templates_for(${organizationId}) t
       order by t.sort_order, t.slug`.execute(this.database.db);

    return rows;
  }

  /**
   * The workspace's workflows instantiated from a template and not archived, newest first —
   * what re-selection reports as kept, and what a repeat selection of the same template reuses.
   *
   * @param organizationId - The workspace.
   * @returns The workflows.
   */
  async instantiatedWorkflows(organizationId: string): Promise<InstantiatedWorkflowRow[]> {
    const rows = await this.database.db
      .selectFrom("workflows")
      .select(["id", "slug", "name", "current_version", "template_slug", "template_version"])
      .where("organization_id", "=", organizationId)
      .where("template_slug", "is not", null)
      .where("status", "<>", "archived")
      .orderBy("created_at", "desc")
      .orderBy("slug")
      .execute();

    return rows.flatMap((row) =>
      row.template_slug === null || row.template_version === null
        ? []
        : [{ ...row, template_slug: row.template_slug, template_version: row.template_version }],
    );
  }
}
