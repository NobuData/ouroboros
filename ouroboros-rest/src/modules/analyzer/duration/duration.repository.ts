/**
 * The duration chart's reads (BW.2, [#517](https://github.com/NobuData/ouroboros/issues/517)) —
 * the run whose change-points annotate the chart, its `change_point` findings, and what each
 * evidence reference names. The series itself is BI's grain, read by `CorpusRepository.series`.
 *
 * **Every statement is scoped by the workspace.** A finding's evidence references are not foreign
 * keys (V081: retention may remove a build without rewriting the finding), so a reference is
 * resolved only among this workspace's rows — one that names nothing here resolves to nothing.
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

/** A build an evidence reference names. */
export interface BuildEvidence {
  id: string;
  /** The job's number within the workspace — `#412`. */
  number: number;
  /** The job's label — `zephyr build`. */
  label: string;
}

/** A merged commit an evidence reference names. */
export interface MergeEvidence {
  /** The sha as the reference wrote it. */
  sha: string;
  /** The title of the first build of that commit, or null when no build recorded it. */
  title: string | null;
  /** The mirrored PR whose merge produced the commit, or null when the mirror has none. */
  pull_request_id: string | null;
}

/** A workflow version an evidence reference names. */
export interface WorkflowVersionEvidence {
  id: string;
  slug: string;
  /** Null on a draft that was never published. */
  version: number | null;
}

/** A runner pool or a runner an evidence reference names. */
export interface NamedEvidence {
  id: string;
  name: string;
}

/** What the references of a set of findings resolve to, by kind. */
export interface ResolvedEvidence {
  builds: BuildEvidence[];
  merges: MergeEvidence[];
  workflowVersions: WorkflowVersionEvidence[];
  runnerPools: NamedEvidence[];
  runners: NamedEvidence[];
}

/** The ids to resolve, by kind — only the kinds this read can open somewhere. */
export interface EvidenceIds {
  builds: string[];
  merges: string[];
  workflowVersions: string[];
  runnerPools: string[];
  runners: string[];
}

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

  /**
   * What a set of evidence references names in this workspace.
   *
   * @param organizationId - The workspace.
   * @param ids - The references, by kind.
   * @returns Each kind's rows that still exist; a reference retention has removed is absent.
   */
  async evidence(organizationId: string, ids: EvidenceIds): Promise<ResolvedEvidence> {
    const [builds, merges, workflowVersions, runnerPools, runners] = await Promise.all([
      this.builds(organizationId, ids.builds),
      this.merges(organizationId, ids.merges),
      this.workflowVersions(organizationId, ids.workflowVersions),
      this.named(organizationId, "runner_pools", ids.runnerPools),
      this.named(organizationId, "runners", ids.runners),
    ]);

    return { builds, merges, workflowVersions, runnerPools, runners };
  }

  /**
   * @param organizationId - The workspace.
   * @param ids - Build job ids.
   * @returns The builds that exist.
   */
  private async builds(organizationId: string, ids: string[]): Promise<BuildEvidence[]> {
    if (ids.length === 0) {
      return [];
    }

    const { rows } = await sql<BuildEvidence>`
      select b.id::text as id, b.number, b.label
        from ouroboros.build_jobs b
       where b.organization_id = ${organizationId}
         and b.id = any(${ids}::uuid[])`.execute(this.database.db);

    return rows;
  }

  /**
   * A merge is a commit, cited by a sha either side may have abbreviated (V081's rule). Its title
   * is the first build's that recorded it, and its PR the mirrored one whose merge plan produced
   * it — the newest, should two plans name one commit.
   *
   * @param organizationId - The workspace.
   * @param shas - Commit shas, 7–40 hex.
   * @returns One row per sha, with whatever of the two was found.
   */
  private async merges(organizationId: string, shas: string[]): Promise<MergeEvidence[]> {
    if (shas.length === 0) {
      return [];
    }

    const { rows } = await sql<MergeEvidence>`
      select s.sha,
             (select b.title
                from ouroboros.build_jobs b
               where b.organization_id = ${organizationId}
                 and b.commit_sha is not null
                 and (starts_with(b.commit_sha, s.sha) or starts_with(s.sha, b.commit_sha))
               order by b.queued_at, b.number
               limit 1) as title,
             (select p.id::text
                from ouroboros.pr_merge_plans m
                join ouroboros.pull_requests p on p.id = m.pr_id
               where p.organization_id = ${organizationId}
                 and m.merged_result ->> 'sha' is not null
                 and (starts_with(m.merged_result ->> 'sha', s.sha)
                      or starts_with(s.sha, m.merged_result ->> 'sha'))
               order by p.merged_at desc nulls last, p.id
               limit 1) as pull_request_id
        from unnest(${shas}::text[]) as s (sha)`.execute(this.database.db);

    return rows;
  }

  /**
   * @param organizationId - The workspace.
   * @param ids - Workflow version ids.
   * @returns The versions that exist, with their workflow's slug.
   */
  private async workflowVersions(
    organizationId: string,
    ids: string[],
  ): Promise<WorkflowVersionEvidence[]> {
    if (ids.length === 0) {
      return [];
    }

    const { rows } = await sql<WorkflowVersionEvidence>`
      select v.id::text as id, w.slug, v.version
        from ouroboros.workflow_versions v
        join ouroboros.workflows w on w.id = v.workflow_id
       where w.organization_id = ${organizationId}
         and v.id = any(${ids}::uuid[])`.execute(this.database.db);

    return rows;
  }

  /**
   * @param organizationId - The workspace.
   * @param table - `runner_pools` or `runners` — both are named by `name`.
   * @param ids - The rows' ids.
   * @returns The rows that exist.
   */
  private async named(
    organizationId: string,
    table: "runner_pools" | "runners",
    ids: string[],
  ): Promise<NamedEvidence[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.database.db
      .selectFrom(table)
      .select([sql<string>`id::text`.as("id"), "name"])
      .where("organization_id", "=", organizationId)
      .where("id", "in", ids)
      .execute();
  }
}
