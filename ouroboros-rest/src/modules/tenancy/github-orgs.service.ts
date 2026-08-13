/**
 * GitHub organisation enablement — the outer half of the boundary V003 describes.
 *
 * *A repo is in scope only when its own `enabled` and its org's are **both** true.* Nothing
 * in this file or `repos.service.ts` enforces that; they are what *sets* the two flags, and
 * the check belongs to whatever is about to act on a repository. What these two do own is
 * that the flags are only ever set through a workspace that exists, on an organisation that
 * belongs to it.
 *
 * Enablement defaults to off, here as in the migration. A row records that Ouroboros knows
 * about the organisation; the flag records that somebody deliberately turned it on, and
 * anything arriving by a path nobody has thought about yet arrives switched off.
 *
 * **The workspace is checked by the guard, not here.** Every route below carries `{orgId}`,
 * and `tenant.guard.ts` resolves it before a handler runs — a workspace that does not exist
 * and one the caller is not a member of are the same `404`, decided in one place
 * ([#713](https://github.com/NobuData/ouroboros/issues/713)). So the service that used to call
 * `TenantsService.require` first no longer does, and there is no longer a second place where
 * "may this person see this workspace" is answered.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import type { Database, GithubOrg } from "../db/schema";
import { EnablementRepository } from "./enablement.repository";
import { pageOf, windowOf, type Page, type PageQuery } from "./pagination";
import { githubOrgResource, type GithubOrgResource } from "./resources";
import type { CreateGithubOrgBody, UpdateGithubOrgBody } from "./tenancy.dto";
import { orgNotFound } from "./tenancy.errors";

@Injectable()
export class GithubOrgsService {
  constructor(private readonly enablement: EnablementRepository) {}

  /**
   * List a workspace's GitHub organisations, enabled or not.
   *
   * Disabled ones are included deliberately: a settings screen has to render the switch that
   * is off, and a list that hid them would make turning one back on impossible through this
   * API.
   *
   * @param organizationId - Whose organisations.
   * @param query - The window the client asked for.
   * @returns One page of organisations, by login.
   */
  async list(organizationId: string, query: PageQuery): Promise<Page<GithubOrgResource>> {
    const window = windowOf(query);
    const [rows, total] = await Promise.all([
      this.enablement.listOrgs(organizationId, window),
      this.enablement.countOrgs(organizationId),
    ]);

    return pageOf(rows.map(githubOrgResource), total, window);
  }

  /**
   * Add a GitHub organisation to a workspace.
   *
   * @param organizationId - The owning workspace.
   * @param body - The validated request.
   * @returns The organisation as it was stored.
   * @throws {ConflictError} `409 org_taken` when this workspace has already added it — raised
   *   by `github_orgs_org_login_key`, mapped by `constraints.ts`. Scoped to the workspace,
   *   because two workspaces may each enable an organisation they both belong to.
   */
  async add(organizationId: string, body: CreateGithubOrgBody): Promise<GithubOrgResource> {
    return githubOrgResource(
      await this.enablement.createOrg(organizationId, body.login, body.enabled ?? false),
    );
  }

  /**
   * The one workspace-scoped read of a single organisation.
   *
   * @param organizationId - The workspace it must belong to.
   * @param login - Which organisation.
   * @returns The organisation.
   * @throws {NotFoundError} `404 org_not_found`.
   */
  async read(organizationId: string, login: string): Promise<GithubOrgResource> {
    return githubOrgResource(await this.require(organizationId, login));
  }

  /**
   * Enable or disable a GitHub organisation — mockup 01 Step 2's switch.
   *
   * Disabling suspends everything under it without discarding the per-repository choices
   * underneath — that is why V003 carries two flags rather than one, and why this touches
   * only the organisation's.
   *
   * @param organizationId - The workspace it must belong to.
   * @param login - Which organisation.
   * @param body - The validated request.
   * @returns The organisation after the change.
   * @throws {NotFoundError} `404 org_not_found`.
   */
  async setEnabled(
    organizationId: string,
    login: string,
    body: UpdateGithubOrgBody,
  ): Promise<GithubOrgResource> {
    const org = await this.require(organizationId, login);
    const updated = await this.enablement.setOrgEnabled(org.id, body.enabled);

    if (updated === undefined) {
      // Removed between the read and the write. The same `404` the read would have given, so
      // the answer does not depend on which side of the race the caller landed on.
      throw orgNotFound(login);
    }

    return githubOrgResource(updated);
  }

  /**
   * The organisation row, or a `404`.
   *
   * Public because repositories are reached through an organisation, so `repos.service.ts`
   * runs this first and gets the workspace scoping with it.
   *
   * @param organizationId - The workspace it must belong to.
   * @param login - Its GitHub login.
   * @param trx - The transaction to look in, when the caller is inside one.
   * @returns The row.
   * @throws {NotFoundError} `404 org_not_found`.
   */
  async require(
    organizationId: string,
    login: string,
    trx?: Transaction<Database>,
  ): Promise<GithubOrg> {
    const org = await this.enablement.findOrg(organizationId, login, trx);

    if (org === undefined) {
      throw orgNotFound(login);
    }

    return org;
  }
}
