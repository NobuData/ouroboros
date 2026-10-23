/**
 * The workspace reads the live-loop readiness preflight needs (DK.1,
 * [#1318](https://github.com/NobuData/ouroboros/issues/1318)).
 *
 * **Every statement reads, and every statement names the workspace.** A workspace never learns
 * another's repository, workflow, pool or issue through a reason, and the reasons are computed
 * from nothing but these answers. `readiness.repository.spec.ts` compiles each statement and
 * asserts the predicate.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import { SCHEMA_NAME, type EstimateEffort } from "../db/schema";
import { supportsSourceCheckout } from "../farm/gateway/capabilities";
import type { SyncSource } from "../ticket-sources/ticket-sources.repository";
import type { PoolFact } from "./readiness";

/** Runner statuses dispatch would offer a job to — `farm/dispatch/dispatch.repository.ts`. */
const DISPATCHABLE_STATUSES = ["online", "building"] as const;

/** A repository of the workspace, by `owner/name`. */
export interface ReadinessRepositoryRow {
  readonly id: string;
  /** `login/name`, as the workspace stores them. */
  readonly slug: string;
  readonly owner: string;
  readonly name: string;
  readonly enabled: boolean;
}

/** A workflow of the workspace, and the definition of its version in force. */
export interface ReadinessWorkflowRow {
  readonly slug: string;
  /** The version in force, or `null` when nothing is published. */
  readonly version: number | null;
  /** That version's definition, or `undefined` when there is none. */
  readonly definition: unknown;
}

/** An issue of the repository's mirrored backlog, with its latest estimate. */
export interface ReadinessIssueRow {
  readonly number: number;
  readonly title: string;
  readonly size: EstimateEffort | null;
  readonly sizedBy: string | null;
}

@Injectable()
export class ReadinessRepository {
  /**
   * @param database - The pool. Nothing here writes.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * A repository of the workspace, matched case-insensitively.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param owner - The account.
   * @param name - The repository.
   * @returns The repository, or `undefined` when the workspace has none by that name.
   */
  async repository(
    organizationId: string,
    owner: string,
    name: string,
  ): Promise<ReadinessRepositoryRow | undefined> {
    const row = await this.database.db
      .selectFrom("github_repos")
      .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
      .select([
        "github_repos.id as id",
        "github_orgs.login as login",
        "github_repos.name as name",
        "github_repos.enabled as enabled",
      ])
      .where("github_orgs.organization_id", "=", organizationId)
      .where(sql<boolean>`lower(${sql.ref("github_orgs.login")}) = lower(${owner})`)
      .where(sql<boolean>`lower(${sql.ref("github_repos.name")}) = lower(${name})`)
      .orderBy("github_repos.id")
      .limit(1)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          id: row.id,
          slug: `${row.login}/${row.name}`,
          owner: row.login,
          name: row.name,
          enabled: row.enabled,
        };
  }

  /**
   * A workflow of the workspace and its version in force.
   *
   * @param organizationId - The workspace.
   * @param slug - The workflow's slug.
   * @returns The workflow, or `undefined` when the workspace has none by that slug.
   */
  async workflow(organizationId: string, slug: string): Promise<ReadinessWorkflowRow | undefined> {
    const row = await this.database.db
      .selectFrom("workflows")
      .leftJoin("workflow_versions", (join) =>
        join
          .onRef("workflow_versions.workflow_id", "=", "workflows.id")
          .onRef("workflow_versions.version", "=", "workflows.current_version"),
      )
      .select([
        "workflows.slug as slug",
        "workflows.current_version as version",
        "workflow_versions.definition as definition",
      ])
      .where("workflows.organization_id", "=", organizationId)
      .where("workflows.slug", "=", slug)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : { slug: row.slug, version: row.version, definition: row.definition ?? undefined };
  }

  /**
   * Each named pool of the workspace, and how many of its runners are online and eligible —
   * dispatch's eligibility rule (`dispatch.repository.ts#candidates`) without the room check: a
   * busy runner frees itself, an absent one does not.
   *
   * @param organizationId - The workspace.
   * @param names - The pool names the build stages use.
   * @param at - Now, for the pool windows.
   * @returns One fact per name, in the order given.
   */
  async pools(organizationId: string, names: readonly string[], at: Date): Promise<PoolFact[]> {
    if (names.length === 0) {
      return [];
    }

    const pools = await this.database.db
      .selectFrom("runner_pools")
      .select(["id", "name", "executor", "enabled"])
      .where("organization_id", "=", organizationId)
      .where("name", "in", names)
      .execute();

    const runners =
      pools.length === 0
        ? []
        : (
            await sql<{ pool_id: string; capabilities: unknown }>`
              select p.id as pool_id, r.capabilities
                from ${sql.id(SCHEMA_NAME, "runner_pools")} p
                join ${sql.id(SCHEMA_NAME, "runners")} r
                  on r.organization_id = p.organization_id
               where p.organization_id = ${organizationId}
                 and p.id in (${sql.join(pools.map((pool) => pool.id))})
                 and r.desired_state = 'active'
                 and r.status in (${sql.join(DISPATCHABLE_STATUSES)})
                 and (r.pool_id = p.id
                      or exists (
                        select 1
                          from ${sql.id(SCHEMA_NAME, "runner_pool_windows")} w
                         where w.organization_id = r.organization_id
                           and w.runner_id = r.id
                           and w.pool_id = p.id
                           and w.enabled
                           and w.days_of_week @> to_jsonb(
                                 extract(isodow from ${at}::timestamptz at time zone 'UTC')::integer)
                           and (${at}::timestamptz at time zone 'UTC')::time >= w.starts_at
                           and (${at}::timestamptz at time zone 'UTC')::time < w.ends_at))
            `.execute(this.database.db)
          ).rows;

    return names.map((name) => {
      const pool = pools.find((candidate) => candidate.name === name);

      if (pool === undefined) {
        return { name, exists: false, enabled: false, online: 0, eligible: 0 };
      }

      const online = runners.filter((runner) => runner.pool_id === pool.id);

      return {
        name,
        exists: true,
        enabled: pool.enabled,
        online: online.length,
        eligible: online.filter(
          (runner) =>
            supportsSourceCheckout(runner.capabilities) &&
            runsExecutor(runner.capabilities, pool.executor),
        ).length,
      };
    });
  }

  /**
   * The issue number the repository's wizard picked — the canonical ticket, when it is a GitHub
   * issue of this repository (`onboarding.service.ts#issueNumberIn`'s rule).
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case — the wizard's `repo_ref`.
   * @returns The number, or `undefined` when nothing of this repository is picked.
   */
  async pickedIssueNumber(organizationId: string, repo: string): Promise<number | undefined> {
    const row = await this.database.db
      .selectFrom("onboarding_state")
      .innerJoin("tickets", "tickets.id", "onboarding_state.picked_ticket_id")
      .innerJoin("ticket_sources", "ticket_sources.id", "tickets.source_id")
      .select(["tickets.external_id as external_id"])
      .where("onboarding_state.organization_id", "=", organizationId)
      .where("tickets.organization_id", "=", organizationId)
      .where("onboarding_state.repo_ref", "=", repo)
      .where("ticket_sources.kind", "=", "github")
      .where(
        sql<boolean>`lower(${sql.ref("tickets.meta")}->'github'->>'owner') || '/' || lower(${sql.ref("tickets.meta")}->'github'->>'repo') = ${repo}`,
      )
      .executeTakeFirst();
    const issueNumber = row === undefined ? Number.NaN : Number.parseInt(row.external_id, 10);

    return Number.isSafeInteger(issueNumber) ? issueNumber : undefined;
  }

  /**
   * An issue of the repository's mirrored backlog, with its latest estimate (latest-wins,
   * decision K4).
   *
   * @param organizationId - The workspace.
   * @param repositoryId - `github_repos.id`, already found in that workspace.
   * @param issueNumber - The issue's number.
   * @returns The issue, or `undefined` when the backlog does not mirror it.
   */
  async issue(
    organizationId: string,
    repositoryId: string,
    issueNumber: number,
  ): Promise<ReadinessIssueRow | undefined> {
    const { rows } = await sql<{
      number: number;
      title: string;
      effort: EstimateEffort | null;
      estimator: string | null;
    }>`
      select i.number, i.title, e.effort, e.trace->>'estimator' as estimator
        from ${sql.id(SCHEMA_NAME, "github_issues")} i
        left join lateral (
               select ie.effort, ie.trace
                 from ${sql.id(SCHEMA_NAME, "issue_estimates")} ie
                where ie.github_issue_id = i.id
                order by ie.version desc
                limit 1
             ) e on true
       where i.organization_id = ${organizationId}
         and i.github_repo_id = ${repositoryId}
         and i.number = ${issueNumber}
    `.execute(this.database.db);
    const row = rows[0];

    return row === undefined
      ? undefined
      : { number: row.number, title: row.title, size: row.effort, sizedBy: row.estimator };
  }

  /**
   * The GitHub source that mirrors an issue — the source a live run opens its pull request with
   * (`ingest/run-pull-request.repository.ts#ticketSource`'s match: the oldest GitHub ticket with
   * the issue's number and repository).
   *
   * @param organizationId - The workspace.
   * @param repository - The repository, found in that workspace.
   * @param issueNumber - The issue's number.
   * @returns The source, or `undefined` when no GitHub source mirrors the issue.
   */
  async prSource(
    organizationId: string,
    repository: Pick<ReadinessRepositoryRow, "owner" | "name">,
    issueNumber: number,
  ): Promise<SyncSource | undefined> {
    const row = await this.database.db
      .selectFrom("tickets")
      .innerJoin("ticket_sources_public", "ticket_sources_public.id", "tickets.source_id")
      .select([
        "ticket_sources_public.id as id",
        "ticket_sources_public.kind as kind",
        "ticket_sources_public.display_name as display_name",
        "ticket_sources_public.config as config",
        "ticket_sources_public.sync_cursor as sync_cursor",
        "ticket_sources_public.synced_at as synced_at",
      ])
      .where("tickets.organization_id", "=", organizationId)
      .where("ticket_sources_public.organization_id", "=", organizationId)
      .where("ticket_sources_public.kind", "=", "github")
      .where("tickets.external_id", "=", String(issueNumber))
      .where(
        sql<boolean>`lower(${sql.ref("tickets.meta")}->'github'->>'owner') = lower(${repository.owner})`,
      )
      .where(
        sql<boolean>`lower(${sql.ref("tickets.meta")}->'github'->>'repo') = lower(${repository.name})`,
      )
      .orderBy("tickets.created_at")
      .orderBy("tickets.id")
      .limit(1)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          sourceId: row.id,
          organizationId,
          kind: row.kind,
          displayName: row.display_name,
          config: row.config,
          cursor: row.sync_cursor,
          syncedAt: row.synced_at,
        };
  }
}

/**
 * Whether a runner's capability document lists an executor.
 *
 * @param capabilities - `runners.capabilities`.
 * @param executor - The pool's executor.
 * @returns True when `capabilities.executors` holds it.
 */
function runsExecutor(capabilities: unknown, executor: string): boolean {
  if (typeof capabilities !== "object" || capabilities === null) {
    return false;
  }

  const executors = (capabilities as { executors?: unknown }).executors;

  return Array.isArray(executors) && executors.includes(executor);
}
