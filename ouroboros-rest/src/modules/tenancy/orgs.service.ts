/**
 * GitHub organisation enablement — the outer half of the boundary V003 describes.
 *
 * *A repo is in scope only when its own `enabled` and its org's are **both** true.* Nothing
 * in this file or `repos.service.ts` enforces that; they are what *sets* the two flags, and
 * the check belongs to whatever is about to act on a repository. What these two do own is
 * that the flags are only ever set through a tenant that exists, on an organisation that
 * belongs to it.
 *
 * Enablement defaults to off, here as in the migration. A row records that Ouroboros knows
 * about the organisation; the flag records that somebody deliberately turned it on, and
 * anything arriving by a path nobody has thought about yet arrives switched off.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import type { Database, GithubOrg } from "../db/schema";
import { OrgsRepository } from "./orgs.repository";
import { pageOf, windowOf, type Page, type PageQuery } from "./pagination";
import { orgResource, type OrgResource } from "./resources";
import type { CreateOrgBody, UpdateOrgBody } from "./tenancy.dto";
import { orgNotFound } from "./tenancy.errors";
import { TenantsService } from "./tenants.service";

@Injectable()
export class OrgsService {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly tenants: TenantsService,
  ) {}

  /**
   * List a tenant's organisations, enabled or not.
   *
   * Disabled ones are included deliberately: a settings screen has to render the switch that
   * is off, and a list that hid them would make turning one back on impossible through this
   * API.
   *
   * @param tenantId - Whose organisations.
   * @param query - The window the client asked for.
   * @returns One page of organisations, by login.
   * @throws {NotFoundError} `404 tenant_not_found` when there is no such tenant.
   */
  async list(tenantId: string, query: PageQuery): Promise<Page<OrgResource>> {
    await this.tenants.require(tenantId);

    const window = windowOf(query);
    const [rows, total] = await Promise.all([
      this.orgs.listOrgs(tenantId, window),
      this.orgs.countOrgs(tenantId),
    ]);

    return pageOf(rows.map(orgResource), total, window);
  }

  /**
   * Add an organisation to a tenant.
   *
   * @param tenantId - The owning tenant.
   * @param body - The validated request.
   * @returns The organisation as it was stored.
   * @throws {NotFoundError} `404 tenant_not_found` when there is no such tenant.
   * @throws {ConflictError} `409 org_taken` when this tenant has already added it — raised
   *   by `github_orgs_tenant_login_key`, mapped by `constraints.ts`. Scoped to the tenant,
   *   because two tenants may each enable an organisation they both belong to.
   */
  async add(tenantId: string, body: CreateOrgBody): Promise<OrgResource> {
    await this.tenants.require(tenantId);

    return orgResource(await this.orgs.createOrg(tenantId, body.login, body.enabled ?? false));
  }

  /**
   * Enable or disable an organisation.
   *
   * Disabling suspends everything under it without discarding the per-repository choices
   * underneath — that is why V003 carries two flags rather than one, and why this touches
   * only the organisation's.
   *
   * @param tenantId - The tenant it must belong to.
   * @param login - Which organisation.
   * @param body - The validated request.
   * @returns The organisation after the change.
   * @throws {NotFoundError} `404 tenant_not_found` or `404 org_not_found`.
   */
  async setEnabled(tenantId: string, login: string, body: UpdateOrgBody): Promise<OrgResource> {
    const org = await this.require(tenantId, login);
    const updated = await this.orgs.setOrgEnabled(org.id, body.enabled);

    if (updated === undefined) {
      throw orgNotFound(login);
    }

    return orgResource(updated);
  }

  /**
   * The organisation, or a `404`.
   *
   * Public for the same reason `TenantsService.require` is: repositories are reached through
   * an organisation, so `repos.service.ts` runs this first and gets the tenant check with it.
   *
   * @param tenantId - The tenant it must belong to.
   * @param login - Its GitHub login.
   * @param trx - The transaction to look in, when the caller is inside one.
   * @returns The row.
   * @throws {NotFoundError} `404 tenant_not_found` or `404 org_not_found`.
   */
  async require(tenantId: string, login: string, trx?: Transaction<Database>): Promise<GithubOrg> {
    await this.tenants.require(tenantId, trx);

    const org = await this.orgs.findOrg(tenantId, login, trx);

    if (org === undefined) {
      throw orgNotFound(login);
    }

    return org;
  }
}
