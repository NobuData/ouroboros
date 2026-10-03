/**
 * The duration chart's reads (BW.2, [#517](https://github.com/NobuData/ouroboros/issues/517)) —
 * the run whose change-points annotate the chart and its `change_point` findings. The series
 * itself is BI's grain, read by `CorpusRepository.series`; what each evidence reference names is
 * `evidence/evidence.repository.ts`'s.
 *
 * **Every statement is scoped by the workspace.**
 */

import { Injectable } from "@nestjs/common";
import { sql, type Selectable } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { AnalysisFindingsTable } from "../../db/schema";
import type { AnalysisRunRow } from "../analysis.repository";

/** The change-point analyzer's id, which is also its findings' type (engine `changepoint.py`). */
export const CHANGE_POINT = "change_point";

/** A stored finding, as read. */
export type FindingRow = Selectable<AnalysisFindingsTable>;

@Injectable()
export class DurationRepository {
  /** @param database - The typed connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The run whose change-points annotate the chart: the repository's newest ended run in which
   * the change-point analyzer completed.
   *
   * A run in flight has not finished detecting, a failed one kept nothing, and one that reached
   * its budget before the change-point analyzer ran has no detection to show — none of them may
   * blank a chart an earlier run annotated.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @returns The run, or undefined before the first such run.
   */
  async annotatedRun(organizationId: string, repoRef: string): Promise<AnalysisRunRow | undefined> {
    const completed = JSON.stringify([{ id: CHANGE_POINT, status: "completed" }]);

    return this.database.db
      .selectFrom("analysis_runs")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("repo_ref", "=", repoRef)
      .where("status", "in", ["complete", "budget_exceeded"])
      .where("corpus_manifest", "is not", null)
      .where(sql<boolean>`progress -> 'analyzers' @> ${completed}::jsonb`)
      .orderBy("started_at", "desc")
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * A run's change-point findings.
   *
   * @param organizationId - The workspace.
   * @param runId - The run.
   * @returns The findings, oldest breakpoint first.
   */
  async changePoints(organizationId: string, runId: string): Promise<FindingRow[]> {
    return this.database.db
      .selectFrom("analysis_findings")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("run_id", "=", runId)
      .where("finding_type", "=", CHANGE_POINT)
      .orderBy(sql`data ->> 'date'`)
      .orderBy("id")
      .execute();
  }
}
