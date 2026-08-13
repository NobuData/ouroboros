/**
 * Every statement this API issues against `ouroboros.github_orgs` and
 * `ouroboros.github_repos` — the two tables that bound where Ouroboros may operate.
 *
 * One repository for both, because a repository is only ever reached *through* its
 * organisation: V003 hangs `github_repos` off `org_id` rather than off the workspace, so
 * "this workspace's repository" is a two-hop question and answering it in two repositories
 * would mean every caller doing the first hop by hand.
 *
 * **`organization_id`, not `tenant_id`.** V006 re-parented `github_orgs` onto the
 * organization plugin's table and dropped `tenants`
 * ([#708](https://github.com/NobuData/ouroboros/issues/708)); every statement below names the
 * new column, which is the half of [#714](https://github.com/NobuData/ouroboros/issues/714)
 * that makes this module compile again. `github_repos` is untouched by that migration —
 * V003 already reached the workspace *through* the organisation rather than storing it twice,
 * which is the choice that kept the re-parenting to one table.
 *
 * Nothing here consults `enabled` when it reads a row. A disabled organisation is still listed
 * — a settings screen has to show the switch that is off — and it is the *consumer* of this
 * boundary, not this module, that must find both flags true before acting. {@link countsFor}
 * is the one place `enabled` appears in a read, and it counts rather than filters.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, GithubOrg, GithubRepo } from "../db/schema";
import type { PageWindow } from "./pagination";
import { asCount, queryOn } from "./queries";

/** What a repository's enablement request may set. Assembled from a validated body. */
export interface RepoChanges {
  enabled: boolean;
  /** Left alone when absent, rather than cleared — it is discovered, not chosen. */
  default_branch?: string;
}

/**
 * One GitHub organisation with its repositories counted — a Step 2 row's raw material.
 *
 * Named as the query returns it (snake_case, `string` counts) rather than as the resource
 * spells it, which is this module's rule everywhere: `resources.ts` owns the translation, and
 * a repository that pre-translated would put half of it somewhere nobody looks.
 */
export interface GithubOrgCountsRow {
  /** The owning workspace — how the caller groups these back onto organizations. */
  organization_id: string;
  login: string;
  enabled: boolean;
  /** Repositories whose own flag is on. `count(*) filter (…)`, so `pg` returns a string. */
  enabled_repos: string;
  /** Repositories in total, enabled or not. */
  total_repos: string;
  /**
   * The earliest-recorded enabled repository under this organisation, or `null`.
   *
   * A correlated subquery rather than an aggregate, because `min(name)` would answer
   * *alphabetically first* and the mockup's `incl. helios-firmware` is the first one recorded
   * — see `resources.ts` on why earliest beats alphabetical for a line a person reads.
   */
  featured_repo: string | null;
}

@Injectable()
export class EnablementRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * One page of a workspace's GitHub organisations, by login.
   *
   * Alphabetical rather than by creation: the login is what a reader scans for, and the
   * unique index `(organization_id, login)` already orders that way.
   *
   * @param organizationId - Whose organisations.
   * @param window - Which rows to return.
   * @param trx - The transaction to run in, if there is one.
   * @returns The rows for this window.
   */
  async listOrgs(
    organizationId: string,
    window: PageWindow,
    trx?: Transaction<Database>,
  ): Promise<GithubOrg[]> {
    return queryOn(this.database, trx)
      .selectFrom("github_orgs")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .orderBy("login")
      .limit(window.limit)
      .offset(window.offset)
      .execute();
  }

  /**
   * How many GitHub organisations a workspace has.
   *
   * @param organizationId - Whose organisations.
   * @param trx - The transaction to run in, if there is one.
   * @returns The count, ignoring any window.
   */
  async countOrgs(organizationId: string, trx?: Transaction<Database>): Promise<number> {
    const { total } = await queryOn(this.database, trx)
      .selectFrom("github_orgs")
      .select((builder) => builder.fn.countAll<string>().as("total"))
      .where("organization_id", "=", organizationId)
      .executeTakeFirstOrThrow();

    return asCount(total);
  }

  /**
   * Every GitHub organisation of several workspaces, with its repositories counted.
   *
   * **One statement for a whole page of workspaces**, which is the reason this method exists
   * rather than a loop over {@link listOrgs} and {@link countRepos}: `GET /api/v1/orgs` renders
   * up to a hundred rows, and doing it per workspace would be two queries each. Grouped by
   * organisation rather than by workspace so that the switch a row draws — which acts on one
   * `login` — has the counts sitting beside the thing it toggles.
   *
   * @param organizationIds - The workspaces to report on. An empty list is answered without a
   *   query: `in ()` is not valid SQL, and a page of no workspaces has no counts by
   *   definition.
   * @param trx - The transaction to run in, if there is one.
   * @returns One row per GitHub organisation across all of them, by workspace then login. A
   *   workspace with no organisations recorded simply contributes none, which the caller reads
   *   as the zero the mockup's `acme-labs` row shows.
   */
  async countsFor(
    organizationIds: readonly string[],
    trx?: Transaction<Database>,
  ): Promise<GithubOrgCountsRow[]> {
    if (organizationIds.length === 0) {
      return [];
    }

    return (
      queryOn(this.database, trx)
        .selectFrom("github_orgs as org")
        .leftJoin("github_repos as repo", "repo.org_id", "org.id")
        .select((builder) => [
          "org.organization_id",
          "org.login",
          "org.enabled",
          builder.fn
            .count<string>("repo.id")
            .filterWhere("repo.enabled", "=", true)
            .as("enabled_repos"),
          builder.fn.count<string>("repo.id").as("total_repos"),
          builder
            .selectFrom("github_repos as featured")
            .select("featured.name")
            .whereRef("featured.org_id", "=", "org.id")
            .where("featured.enabled", "=", true)
            .orderBy("featured.created_at")
            .orderBy("featured.id")
            .limit(1)
            .as("featured_repo"),
        ])
        // Every non-aggregated column is listed rather than relying on PostgreSQL's functional
        // dependency on `org.id`: the dependency is real and the explicit list is what keeps
        // this query portable to a `group by` that does not know about the primary key.
        .groupBy(["org.id", "org.organization_id", "org.login", "org.enabled"])
        .where("org.organization_id", "in", organizationIds)
        .orderBy("org.organization_id")
        .orderBy("org.login")
        .execute()
    );
  }

  /**
   * Find one of a workspace's GitHub organisations by its login.
   *
   * @param organizationId - The workspace it must belong to.
   * @param login - The GitHub login, lower-cased.
   * @param trx - The transaction to run in, if there is one.
   * @returns The row, or `undefined`.
   */
  async findOrg(
    organizationId: string,
    login: string,
    trx?: Transaction<Database>,
  ): Promise<GithubOrg | undefined> {
    return queryOn(this.database, trx)
      .selectFrom("github_orgs")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("login", "=", login)
      .executeTakeFirst();
  }

  /**
   * Add a GitHub organisation to a workspace.
   *
   * @param organizationId - The owning workspace.
   * @param login - The GitHub login, lower-cased by its DTO.
   * @param enabled - Whether Ouroboros may operate in it. The caller passes V003's own
   *   default when the request said nothing, rather than omitting the column, so the API's
   *   default and the schema's are visibly the same decision.
   * @param trx - The transaction to run in, if there is one.
   * @returns The stored row.
   */
  async createOrg(
    organizationId: string,
    login: string,
    enabled: boolean,
    trx?: Transaction<Database>,
  ): Promise<GithubOrg> {
    return queryOn(this.database, trx)
      .insertInto("github_orgs")
      .values({ organization_id: organizationId, login, enabled })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Enable or disable a GitHub organisation.
   *
   * @param orgId - The organisation to change — `github_orgs.id`.
   * @param enabled - What to set the flag to.
   * @param trx - The transaction to run in, if there is one.
   * @returns The updated row, or `undefined` when no organisation has that id.
   */
  async setOrgEnabled(
    orgId: string,
    enabled: boolean,
    trx?: Transaction<Database>,
  ): Promise<GithubOrg | undefined> {
    return queryOn(this.database, trx)
      .updateTable("github_orgs")
      .set({ enabled })
      .where("id", "=", orgId)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * One page of an organisation's repositories, by name.
   *
   * @param orgId - Whose repositories — `github_orgs.id`.
   * @param window - Which rows to return.
   * @param trx - The transaction to run in, if there is one.
   * @returns The rows for this window.
   */
  async listRepos(
    orgId: string,
    window: PageWindow,
    trx?: Transaction<Database>,
  ): Promise<GithubRepo[]> {
    return queryOn(this.database, trx)
      .selectFrom("github_repos")
      .selectAll()
      .where("org_id", "=", orgId)
      .orderBy("name")
      .limit(window.limit)
      .offset(window.offset)
      .execute();
  }

  /**
   * How many repositories an organisation has.
   *
   * @param orgId - Whose repositories.
   * @param trx - The transaction to run in, if there is one.
   * @returns The count, ignoring any window.
   */
  async countRepos(orgId: string, trx?: Transaction<Database>): Promise<number> {
    const { total } = await queryOn(this.database, trx)
      .selectFrom("github_repos")
      .select((builder) => builder.fn.countAll<string>().as("total"))
      .where("org_id", "=", orgId)
      .executeTakeFirstOrThrow();

    return asCount(total);
  }

  /**
   * Enable or disable a repository, creating its row the first time it is named.
   *
   * An upsert rather than a create and an update, and that is the whole reason the operation
   * is one request: there is no discovery flow yet to have created the row — V003 says the
   * GitHub App installation that would is future product work — so a screen that offers a
   * switch for a repository nobody has recorded would otherwise have to `POST` it first and
   * handle the conflict when two people did.
   *
   * `on conflict … do update` is what makes that atomic. The alternative — select, then
   * insert or update — is the race `github_repos_org_name_key` would refuse, and refusing it
   * is not the behaviour a switch wants.
   *
   * @param orgId - The organisation it belongs to.
   * @param name - The repository's name within that organisation, lower-cased by its DTO.
   * @param changes - The flag, and the default branch when the caller supplied one.
   * @param trx - The transaction to run in, if there is one.
   * @returns The stored row, created or updated.
   */
  async upsertRepo(
    orgId: string,
    name: string,
    changes: RepoChanges,
    trx?: Transaction<Database>,
  ): Promise<GithubRepo> {
    return queryOn(this.database, trx)
      .insertInto("github_repos")
      .values({ org_id: orgId, name, ...changes })
      .onConflict((conflict) => conflict.columns(["org_id", "name"]).doUpdateSet(changes))
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Find one repository within an organisation.
   *
   * @param orgId - The organisation it must belong to.
   * @param name - Its name, lower-cased.
   * @param trx - The transaction to run in, if there is one.
   * @returns The row, or `undefined`.
   */
  async findRepo(
    orgId: string,
    name: string,
    trx?: Transaction<Database>,
  ): Promise<GithubRepo | undefined> {
    return queryOn(this.database, trx)
      .selectFrom("github_repos")
      .selectAll()
      .where("org_id", "=", orgId)
      .where("name", "=", name)
      .executeTakeFirst();
  }
}
