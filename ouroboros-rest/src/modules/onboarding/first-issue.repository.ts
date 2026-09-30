/**
 * The statements behind the safe-first-issue picker
 * ([#387](https://github.com/NobuData/ouroboros/issues/387), BB.4).
 *
 * ```
 * backlog         the repository's open issues, counted by sizing status    github_issues   (V014)
 * candidates      its sized issues, each with the estimate in force and     issue_estimates (V026)
 *                 the rate its routed model resolves to                     model_price()
 * protectedPaths  the repository's protected globs                          protected_path_policies (V067)
 * ```
 *
 * The backlog is the GitHub mirror INTAKE-L.3 (#107) sizes. Every statement is held to the
 * workspace, so another workspace's mirror of the same repository is never read. Nothing here
 * writes, and nothing here scores — that is `first-issue.score.ts`.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import { SCHEMA_NAME, type BillingMode, type EstimateEffort } from "../db/schema";

/** The repository's open issues, by where sizing has got to. */
export interface BacklogCounts {
  /** Every open issue. */
  readonly open: number;
  /** Open and `sized` — the picker's candidates. */
  readonly sized: number;
  /** Open and `unsized` or `estimating` — still waiting for the estimator. */
  readonly sizing: number;
  /** Open and `needs_human` — the estimator declined to size it confidently. */
  readonly needsHuman: number;
}

/** One sized open issue with its estimate in force and its model's rate. */
export interface CandidateRow {
  readonly issueId: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly updatedAt: Date;
  readonly version: number;
  readonly effort: EstimateEffort;
  readonly suggestedWorkflow: string;
  readonly routedModel: string;
  readonly files: readonly string[];
  readonly cycleMin: number;
  readonly cycleMax: number;
  readonly estTokens: number;
  /** What `ouroboros.model_price()` resolved the routed model to, or null. */
  readonly price: {
    readonly billingMode: BillingMode;
    readonly inputCentsPer1m: string | null;
  } | null;
}

@Injectable()
export class FirstIssueRepository {
  /**
   * @param database - The typed connection.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Count a repository's open issues by sizing status.
   *
   * @param organizationId - The workspace.
   * @param repositoryId - `github_repos.id`, already found in that workspace.
   * @returns The counts — zeros for a repository with no open issues.
   */
  async backlog(organizationId: string, repositoryId: string): Promise<BacklogCounts> {
    const { rows } = await sql<{
      open: string | number;
      sized: string | number;
      sizing: string | number;
      needs_human: string | number;
    }>`
      select count(*) as open,
             count(*) filter (where i.sizing_status = 'sized') as sized,
             count(*) filter (where i.sizing_status in ('unsized', 'estimating')) as sizing,
             count(*) filter (where i.sizing_status = 'needs_human') as needs_human
        from ${sql.id(SCHEMA_NAME, "github_issues")} i
       where i.organization_id = ${organizationId}
         and i.github_repo_id = ${repositoryId}
         and i.state = 'open'
    `.execute(this.database.db);
    const row = rows[0];

    return {
      open: Number(row?.open ?? 0),
      sized: Number(row?.sized ?? 0),
      sizing: Number(row?.sizing ?? 0),
      needsHuman: Number(row?.needs_human ?? 0),
    };
  }

  /**
   * A repository's sized open issues, each with its latest estimate (latest-wins, decision K4)
   * and the rate its routed model resolves to.
   *
   * The rate is `ouroboros.model_price()` — the one pricing lookup — asked with the connection
   * kind of the workspace alias that routes to the model, or with no kind when no alias does:
   * the planning footer's statement, applied to issues.
   *
   * @param organizationId - The workspace — also the pricing lookup's scope.
   * @param repositoryId - `github_repos.id`, already found in that workspace.
   * @returns The candidates, by issue number.
   */
  async candidates(organizationId: string, repositoryId: string): Promise<CandidateRow[]> {
    const { rows } = await sql<{
      issue_id: string;
      number: number;
      title: string;
      url: string;
      updated_at: Date;
      version: number;
      effort: EstimateEffort;
      suggested_workflow: string;
      routed_model: string;
      files: unknown;
      cycle_min: number;
      cycle_max: number;
      est_tokens: number;
      billing_mode: BillingMode | null;
      input_cents_per_1m: string | null;
    }>`
      select i.id as issue_id, i.number, i.title, i.gh_url as url, i.gh_updated_at as updated_at,
             e.version, e.effort, e.suggested_workflow, e.routed_model,
             e.breakdown->'files' as files,
             (e.breakdown->>'cycle_min')::float8 as cycle_min,
             (e.breakdown->>'cycle_max')::float8 as cycle_max,
             (e.breakdown->>'est_tokens')::float8 as est_tokens,
             p.billing_mode, p.input_cents_per_1m::text as input_cents_per_1m
        from ${sql.id(SCHEMA_NAME, "github_issues")} i
        join lateral (
               select ie.*
                 from ${sql.id(SCHEMA_NAME, "issue_estimates")} ie
                where ie.github_issue_id = i.id
                order by ie.version desc
                limit 1
             ) e on true
        left join lateral (
               select c.kind
                 from ${sql.id(SCHEMA_NAME, "model_aliases")} a
                 join ${sql.id(SCHEMA_NAME, "provider_connections")} c
                   on c.id = a.provider_connection_id and c.organization_id = a.organization_id
                where a.organization_id = ${organizationId}
                  and a.model_id = e.routed_model
                order by a.alias
                limit 1
             ) k on true
        left join lateral ${sql.id(SCHEMA_NAME)}.model_price(${organizationId}, k.kind, e.routed_model) p
          on true
       where i.organization_id = ${organizationId}
         and i.github_repo_id = ${repositoryId}
         and i.state = 'open'
         and i.sizing_status = 'sized'
       order by i.number
    `.execute(this.database.db);

    return rows.map((row) => ({
      issueId: row.issue_id,
      number: row.number,
      title: row.title,
      url: row.url,
      updatedAt: row.updated_at,
      version: row.version,
      effort: row.effort,
      suggestedWorkflow: row.suggested_workflow,
      routedModel: row.routed_model,
      files: Array.isArray(row.files)
        ? row.files.filter((f): f is string => typeof f === "string")
        : [],
      cycleMin: row.cycle_min,
      cycleMax: row.cycle_max,
      estTokens: row.est_tokens,
      price:
        row.billing_mode === null
          ? null
          : { billingMode: row.billing_mode, inputCentsPer1m: row.input_cents_per_1m },
    }));
  }

  /**
   * The repository's protected-path globs (V067, #380) — a candidate touching one is
   * disqualified.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case, as the wizard stores it.
   * @returns The globs, sorted.
   */
  async protectedPaths(organizationId: string, repo: string): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom("protected_path_policies")
      .select("path_glob")
      .where("organization_id", "=", organizationId)
      .where("repo_ref", "=", repo)
      .orderBy("path_glob")
      .execute();

    return rows.map((row) => row.path_glob);
  }
}
