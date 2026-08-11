/**
 * Every statement this API issues against `ouroboros.github_orgs` and
 * `ouroboros.github_repos` — the two tables that bound where Ouroboros may operate.
 *
 * One repository for both, because a repository is only ever reached *through* its
 * organisation: V003 hangs `github_repos` off `org_id` rather than off the tenant, so
 * "this tenant's repository" is a two-hop question and answering it in two repositories
 * would mean every caller doing the first hop by hand.
 *
 * Nothing here consults `enabled` when it reads. A disabled organisation is still listed —
 * a settings screen has to show the switch that is off — and it is the *consumer* of this
 * boundary, not this module, that must find both flags true before acting.
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

@Injectable()
export class OrgsRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * One page of a tenant's organisations, by login.
   *
   * Alphabetical rather than by creation: the login is what a reader scans for, and the
   * unique index `(tenant_id, login)` already orders that way.
   *
   * @param tenantId - Whose organisations.
   * @param window - Which rows to return.
   * @param trx - The transaction to run in, if there is one.
   * @returns The rows for this window.
   */
  async listOrgs(
    tenantId: string,
    window: PageWindow,
    trx?: Transaction<Database>,
  ): Promise<GithubOrg[]> {
    return queryOn(this.database, trx)
      .selectFrom("github_orgs")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("login")
      .limit(window.limit)
      .offset(window.offset)
      .execute();
  }

  /**
   * How many organisations a tenant has.
   *
   * @param tenantId - Whose organisations.
   * @param trx - The transaction to run in, if there is one.
   * @returns The count, ignoring any window.
   */
  async countOrgs(tenantId: string, trx?: Transaction<Database>): Promise<number> {
    const { total } = await queryOn(this.database, trx)
      .selectFrom("github_orgs")
      .select((builder) => builder.fn.countAll<string>().as("total"))
      .where("tenant_id", "=", tenantId)
      .executeTakeFirstOrThrow();

    return asCount(total);
  }

  /**
   * Find one of a tenant's organisations by its login.
   *
   * @param tenantId - The tenant it must belong to.
   * @param login - The GitHub login, lower-cased.
   * @param trx - The transaction to run in, if there is one.
   * @returns The row, or `undefined`.
   */
  async findOrg(
    tenantId: string,
    login: string,
    trx?: Transaction<Database>,
  ): Promise<GithubOrg | undefined> {
    return queryOn(this.database, trx)
      .selectFrom("github_orgs")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("login", "=", login)
      .executeTakeFirst();
  }

  /**
   * Add an organisation to a tenant.
   *
   * @param tenantId - The owning tenant.
   * @param login - The GitHub login, lower-cased by its DTO.
   * @param enabled - Whether Ouroboros may operate in it. The caller passes V003's own
   *   default when the request said nothing, rather than omitting the column, so the API's
   *   default and the schema's are visibly the same decision.
   * @param trx - The transaction to run in, if there is one.
   * @returns The stored row.
   */
  async createOrg(
    tenantId: string,
    login: string,
    enabled: boolean,
    trx?: Transaction<Database>,
  ): Promise<GithubOrg> {
    return queryOn(this.database, trx)
      .insertInto("github_orgs")
      .values({ tenant_id: tenantId, login, enabled })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Enable or disable an organisation.
   *
   * @param orgId - The organisation to change.
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
   * @param orgId - Whose repositories.
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
