/**
 * The reads and writes CM.3's estimator makes against V106/V109's research tables.
 *
 * [#622](https://github.com/NobuData/ouroboros/issues/622). Every statement is scoped to one
 * workspace by its first argument — an investigation or a kind of another workspace is simply
 * not found, the same answer as one that does not exist.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import {
  SCHEMA_NAME,
  type InvestigationDepth,
  type InvestigationEstimateDocument,
  type InvestigationEstimateOutcome,
  type InvestigationStatus,
} from "../db/schema";

/** A kind, as the estimator needs it: its slug and the tools its playbook turns on. */
export interface KindDefaults {
  readonly slug: string;
  readonly defaultTools: readonly string[];
}

/** An investigation, as the estimator needs it. */
export interface InvestigationScope {
  readonly id: string;
  readonly displayId: string;
  readonly depth: InvestigationDepth;
  readonly tools: readonly string[];
  readonly status: InvestigationStatus;
}

@Injectable()
export class ResearchRepository {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One kind of this workspace, by slug.
   *
   * @param organizationId - The workspace.
   * @param slug - `gap_analysis`.
   * @returns Its slug and playbook default tools, or undefined when the workspace has no such kind.
   */
  async findKind(organizationId: string, slug: string): Promise<KindDefaults | undefined> {
    const row = await this.database.db
      .selectFrom("investigation_kinds")
      .select(["slug", "playbook"])
      .where("organization_id", "=", organizationId)
      .where("slug", "=", slug)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : { slug: row.slug, defaultTools: row.playbook.default_tools };
  }

  /**
   * The slugs in a selection that `research_tools` has no row for.
   *
   * @param tools - The selection.
   * @returns The unknown slugs, in selection order; empty when every slug is registered.
   */
  async unknownTools(tools: readonly string[]): Promise<string[]> {
    if (tools.length === 0) {
      return [];
    }

    const rows = await this.database.db
      .selectFrom("research_tools")
      .select("slug")
      .where("slug", "in", [...tools])
      .execute();

    const known = new Set(rows.map((row) => row.slug));
    return tools.filter((tool) => !known.has(tool));
  }

  /**
   * One investigation of this workspace.
   *
   * @param organizationId - The workspace.
   * @param investigationId - Its id.
   * @returns Its depth, tools and status, or undefined when the workspace has no such investigation.
   */
  async findInvestigation(
    organizationId: string,
    investigationId: string,
  ): Promise<InvestigationScope | undefined> {
    const row = await this.database.db
      .selectFrom("investigations")
      .select(["id", "display_id", "depth", "tools_enabled", "status"])
      .where("organization_id", "=", organizationId)
      .where("id", "=", investigationId)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          id: row.id,
          displayId: row.display_id,
          depth: row.depth,
          tools: row.tools_enabled,
          status: row.status,
        };
  }

  /**
   * Stores an estimate on a **queued** investigation, with the calibration that computed it.
   *
   * The status condition is in the statement rather than checked beforehand, so an investigation
   * that started between the read and this write keeps the estimate it started under.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @param estimate - The stored shape — `{sources, cost_cents}`.
   * @param calibrationVersion - The estimator calibration.
   * @returns Whether a queued investigation was updated.
   */
  async storeEstimate(
    organizationId: string,
    investigationId: string,
    estimate: InvestigationEstimateDocument,
    calibrationVersion: number,
  ): Promise<boolean> {
    const result = await this.database.db
      .updateTable("investigations")
      .set({
        estimate: JSON.stringify(estimate),
        estimate_calibration_version: calibrationVersion,
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", investigationId)
      .where("status", "=", "queued")
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  /**
   * Records (or refreshes) the estimate-vs-actuals comparison through V109's idempotent fill.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns The outcome row, or undefined when the investigation lacks an estimate or actuals
   *   (or is not this workspace's).
   */
  async recordOutcome(
    organizationId: string,
    investigationId: string,
  ): Promise<InvestigationEstimateOutcome | undefined> {
    const { rows } = await sql<InvestigationEstimateOutcome>`
      select *
        from ${sql.id(SCHEMA_NAME)}.record_investigation_estimate_outcome(
               ${organizationId}, ${investigationId}::uuid)
    `.execute(this.database.db);

    return rows[0];
  }
}
