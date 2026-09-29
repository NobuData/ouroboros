/**
 * Every statement the onboarding wizard API issues
 * ([#385](https://github.com/NobuData/ouroboros/issues/385), BB.2).
 *
 * Two kinds, kept visibly apart because decision **O1** is about the difference:
 *
 *   * **Writes touch `onboarding_state` only**, and only its choice columns — the template, the
 *     ticket, dismissed, completed_at, bypassed_at. There is no statement here that could store
 *     a step status, because the table has no column to hold one.
 *   * **Reads ask each subsystem its own question** — sources, tenancy, workflows, intake — and
 *     return the rows as the owner keeps them. Turning those rows into a rail is
 *     `onboarding.derivation.ts`'s job, not this file's.
 *
 * Every statement is scoped by `organization_id`, which is the whole of cross-tenant isolation
 * for this surface: a repository reference or a ticket id from another workspace simply matches
 * nothing.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { OnboardingState, TicketSourceStatus } from "../db/schema";

/** The choice columns a `PATCH` may set. Absent keys are left alone. */
export interface OnboardingChoices {
  selected_template?: string | null;
  picked_ticket_id?: string | null;
  dismissed?: boolean;
}

/** A GitHub ticket source of the workspace, as `ticket_sources_public` holds it. */
export interface GithubSourceRow {
  display_name: string;
  status: TicketSourceStatus;
  status_reason: string | null;
  config: unknown;
}

/** A repository of the workspace's GitHub mirror, with its account's switch. */
export interface RepositoryRow {
  id: string;
  enabled: boolean;
  account_enabled: boolean;
}

/** A workflow carrying template provenance (V068). */
export interface InstantiatedWorkflowRow {
  slug: string;
  template_slug: string;
  template_version: number;
}

/** A canonical ticket of the workspace, with its source's kind. */
export interface TicketRow {
  id: string;
  external_id: string;
  external_key: string;
  title: string;
  meta: unknown;
  kind: string;
}

/** The newest detection scan of a repository — the detection card's reference. */
export interface ScanRow {
  scan_seq: number;
  scanned_at: Date;
  duration_ms: number;
}

/** A template tile the workspace sees (`workflow_templates_for`, V068). */
export interface TemplateRow {
  slug: string;
  version: number;
  tier: string;
  organization_id: string | null;
}

@Injectable()
export class OnboardingRepository {
  /**
   * @param database - The typed connection, injected.
   */
  constructor(private readonly database: DatabaseService) {}

  // ---------------------------------------------------------------------------------------
  // The wizard's own memory
  // ---------------------------------------------------------------------------------------

  /**
   * One repository's wizard state.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @returns The row, or `undefined` when the wizard has never been written for it.
   */
  async state(organizationId: string, repo: string): Promise<OnboardingState | undefined> {
    return this.database.db
      .selectFrom("onboarding_state")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("repo_ref", "=", repo)
      .executeTakeFirst();
  }

  /**
   * Store the choices a `PATCH` carried, creating the row on the first write.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @param choices - The columns to set; at least one key present.
   * @returns The row as stored.
   */
  async saveChoices(
    organizationId: string,
    repo: string,
    choices: OnboardingChoices,
  ): Promise<OnboardingState> {
    return this.database.db
      .insertInto("onboarding_state")
      .values({ organization_id: organizationId, repo_ref: repo, ...choices })
      .onConflict((conflict) =>
        conflict.columns(["organization_id", "repo_ref"]).doUpdateSet(choices),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Stamp the wizard completed. The first completion stands: a second one keeps its time.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @returns The row as stored.
   */
  async markCompleted(organizationId: string, repo: string): Promise<OnboardingState> {
    return this.database.db
      .insertInto("onboarding_state")
      .values({ organization_id: organizationId, repo_ref: repo, completed_at: sql`now()` })
      .onConflict((conflict) =>
        conflict.columns(["organization_id", "repo_ref"]).doUpdateSet({
          completed_at: sql`coalesce(onboarding_state.completed_at, now())`,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Stamp the import-skip (V070). The first bypass stands, as the first completion does.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @returns The row as stored.
   */
  async markBypassed(organizationId: string, repo: string): Promise<OnboardingState> {
    return this.database.db
      .insertInto("onboarding_state")
      .values({ organization_id: organizationId, repo_ref: repo, bypassed_at: sql`now()` })
      .onConflict((conflict) =>
        conflict.columns(["organization_id", "repo_ref"]).doUpdateSet({
          bypassed_at: sql`coalesce(onboarding_state.bypassed_at, now())`,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Whether any repository's wizard in the workspace has been finished — completed, dismissed
   * or bypassed. Half of the surfacing rule.
   *
   * @param organizationId - The workspace.
   * @returns True when at least one has.
   */
  async anyWizardFinished(organizationId: string): Promise<boolean> {
    const row = await this.database.db
      .selectFrom("onboarding_state")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where((where) =>
        where.or([
          where("completed_at", "is not", null),
          where("dismissed", "=", true),
          where("bypassed_at", "is not", null),
        ]),
      )
      .limit(1)
      .executeTakeFirst();

    return row !== undefined;
  }

  // ---------------------------------------------------------------------------------------
  // The subsystems the rail is derived from
  // ---------------------------------------------------------------------------------------

  /**
   * The workspace's GitHub ticket sources (WF-Q), credential-free.
   *
   * @param organizationId - The workspace.
   * @returns Every `github` source, in name order.
   */
  async githubSources(organizationId: string): Promise<GithubSourceRow[]> {
    return this.database.db
      .selectFrom("ticket_sources_public")
      .select(["display_name", "status", "status_reason", "config"])
      .where("organization_id", "=", organizationId)
      .where("kind", "=", "github")
      .orderBy("display_name")
      .execute();
  }

  /**
   * Whether a GitHub account of the workspace has the App installed (`installed_at`).
   *
   * @param organizationId - The workspace.
   * @param login - The account, lower-case.
   * @returns True when the account exists and records an installation.
   */
  async appInstalled(organizationId: string, login: string): Promise<boolean> {
    const row = await this.database.db
      .selectFrom("github_orgs")
      .select("installed_at")
      .where("organization_id", "=", organizationId)
      .where("login", "=", login)
      .executeTakeFirst();

    return row?.installed_at != null;
  }

  /**
   * A repository of the workspace's GitHub mirror, by `owner/name`.
   *
   * @param organizationId - The workspace.
   * @param owner - The account, lower-case.
   * @param name - The repository, lower-case.
   * @returns Its id and both switches, or `undefined` when the workspace mirrors no such
   *   repository.
   */
  async repository(
    organizationId: string,
    owner: string,
    name: string,
  ): Promise<RepositoryRow | undefined> {
    return this.database.db
      .selectFrom("github_repos")
      .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
      .select([
        "github_repos.id as id",
        "github_repos.enabled as enabled",
        "github_orgs.enabled as account_enabled",
      ])
      .where("github_orgs.organization_id", "=", organizationId)
      .where("github_orgs.login", "=", owner)
      .where("github_repos.name", "=", name)
      .executeTakeFirst();
  }

  /**
   * The newest workflow of the workspace instantiated from a template (V068 provenance).
   *
   * @param organizationId - The workspace.
   * @param templateSlug - The template picked.
   * @returns The workflow, or `undefined` when none carries that provenance.
   */
  async instantiatedWorkflow(
    organizationId: string,
    templateSlug: string,
  ): Promise<InstantiatedWorkflowRow | undefined> {
    const row = await this.database.db
      .selectFrom("workflows")
      .select(["slug", "template_slug", "template_version"])
      .where("organization_id", "=", organizationId)
      .where("template_slug", "=", templateSlug)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();

    if (row === undefined || row.template_slug === null || row.template_version === null) {
      return undefined;
    }

    return {
      slug: row.slug,
      template_slug: row.template_slug,
      template_version: row.template_version,
    };
  }

  /**
   * A canonical ticket of the workspace, with its source's kind.
   *
   * @param organizationId - The workspace.
   * @param ticketId - The ticket.
   * @returns The ticket, or `undefined` when the workspace has no such ticket — another
   *   workspace's ticket included.
   */
  async ticket(organizationId: string, ticketId: string): Promise<TicketRow | undefined> {
    return this.database.db
      .selectFrom("tickets")
      .innerJoin("ticket_sources", "ticket_sources.id", "tickets.source_id")
      .select([
        "tickets.id as id",
        "tickets.external_id as external_id",
        "tickets.external_key as external_key",
        "tickets.title as title",
        "tickets.meta as meta",
        "ticket_sources.kind as kind",
      ])
      .where("tickets.organization_id", "=", organizationId)
      .where("tickets.id", "=", ticketId)
      .executeTakeFirst();
  }

  /**
   * Whether an issue of a repository has reached the loop — queued, and/or run.
   *
   * @param organizationId - The workspace.
   * @param repositoryId - `github_repos.id`.
   * @param issueNumber - The issue's number.
   * @returns Both answers.
   */
  async reachedLoop(
    organizationId: string,
    repositoryId: string,
    issueNumber: number,
  ): Promise<{ queued: boolean; run: boolean }> {
    const queued = await this.database.db
      .selectFrom("queue_items")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("github_repo_id", "=", repositoryId)
      .where("issue_number", "=", issueNumber)
      .limit(1)
      .executeTakeFirst();
    const run = await this.database.db
      .selectFrom("runs")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("github_repo_id", "=", repositoryId)
      .where("issue_number", "=", issueNumber)
      .limit(1)
      .executeTakeFirst();

    return { queued: queued !== undefined, run: run !== undefined };
  }

  /**
   * Whether the workspace has ever had a run. The other half of the surfacing rule.
   *
   * @param organizationId - The workspace.
   * @returns True when at least one run exists.
   */
  async hasRuns(organizationId: string): Promise<boolean> {
    const row = await this.database.db
      .selectFrom("runs")
      .select("id")
      .where("organization_id", "=", organizationId)
      .limit(1)
      .executeTakeFirst();

    return row !== undefined;
  }

  // ---------------------------------------------------------------------------------------
  // Card payload references
  // ---------------------------------------------------------------------------------------

  /**
   * The newest detection scan of a repository.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @returns The scan, or `undefined` when the repository was never scanned.
   */
  async latestScan(organizationId: string, repo: string): Promise<ScanRow | undefined> {
    return this.database.db
      .selectFrom("repo_detection_scans")
      .select(["scan_seq", "scanned_at", "duration_ms"])
      .where("organization_id", "=", organizationId)
      .where("repo_ref", "=", repo)
      .orderBy("scan_seq", "desc")
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * The template tiles the workspace sees — V068's resolver, which lets an organization's row
   * shadow the global row of the same slug.
   *
   * @param organizationId - The workspace.
   * @returns One row per slug, in tile order.
   */
  async templates(organizationId: string): Promise<TemplateRow[]> {
    const { rows } = await sql<TemplateRow>`
      select t.slug, t.version, t.tier, t.organization_id
        from ouroboros.workflow_templates_for(${organizationId}) t`.execute(this.database.db);

    return rows;
  }
}
