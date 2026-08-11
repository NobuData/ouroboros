/**
 * The rules about a tenant's email domains — one of which needs a transaction.
 *
 * `tenant_domains_one_primary_per_tenant` is a partial unique index over the rows where
 * `is_primary` is true (V001), so "make this one primary" cannot be a single `update`: the
 * row that holds the flag has to give it up first, and between the two statements the index
 * would refuse a second primary. Both statements therefore run inside
 * `DatabaseService.transaction`, which is also what makes the intermediate state — a tenant
 * with no primary domain at all — invisible to every other connection.
 *
 * The other three operations are ordinary. What they share is that each one begins by
 * requiring the tenant, so a domain request against a tenant that does not exist is a `404`
 * about the tenant rather than an empty list or a foreign-key error.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import { DomainsRepository } from "./domains.repository";
import { pageOf, windowOf, type Page, type PageQuery } from "./pagination";
import { domainResource, type DomainResource } from "./resources";
import type { CreateDomainBody, UpdateDomainBody } from "./tenancy.dto";
import { domainNotFound } from "./tenancy.errors";
import { TenantsService } from "./tenants.service";

@Injectable()
export class DomainsService {
  constructor(
    private readonly domains: DomainsRepository,
    private readonly tenants: TenantsService,
    private readonly database: DatabaseService,
  ) {}

  /**
   * List a tenant's domains.
   *
   * @param tenantId - Whose domains.
   * @param query - The window the client asked for.
   * @returns One page of domains, the primary first.
   * @throws {NotFoundError} `404 tenant_not_found` when there is no such tenant.
   */
  async list(tenantId: string, query: PageQuery): Promise<Page<DomainResource>> {
    await this.tenants.require(tenantId);

    const window = windowOf(query);
    const [rows, total] = await Promise.all([
      this.domains.list(tenantId, window),
      this.domains.count(tenantId),
    ]);

    return pageOf(rows.map(domainResource), total, window);
  }

  /**
   * Add a domain to a tenant.
   *
   * Adding one *as* the primary is the two-statement case, so the whole operation runs in a
   * transaction whenever `isPrimary` is asked for — including the tenant check, so a tenant
   * deleted mid-request cannot leave a domain behind.
   *
   * @param tenantId - The owning tenant.
   * @param body - The validated request.
   * @returns The domain as it was stored.
   * @throws {NotFoundError} `404 tenant_not_found` when there is no such tenant.
   * @throws {ConflictError} `409 domain_taken` when the domain is already another tenant's —
   *   raised by `tenant_domains_domain_key`, mapped by `constraints.ts`. This is the issue's
   *   worked example of a constraint violation becoming an answer.
   */
  async add(tenantId: string, body: CreateDomainBody): Promise<DomainResource> {
    const isPrimary = body.isPrimary ?? false;

    return this.database.transaction(async (trx) => {
      await this.tenants.require(tenantId, trx);

      if (isPrimary) {
        await this.domains.clearPrimary(tenantId, trx);
      }

      return domainResource(await this.domains.create(tenantId, body.domain, isPrimary, trx));
    });
  }

  /**
   * Promote a domain to primary, or demote it.
   *
   * Demotion is allowed to leave the tenant with no primary at all: V001 permits zero, and a
   * tenant part-way through changing which domain it presents is a real state rather than
   * one to refuse.
   *
   * @param tenantId - The tenant the domain must belong to.
   * @param domainId - The domain to change.
   * @param body - The validated request.
   * @returns The domain after the change.
   * @throws {NotFoundError} `404 tenant_not_found` or `404 domain_not_found`.
   */
  async setPrimary(
    tenantId: string,
    domainId: string,
    body: UpdateDomainBody,
  ): Promise<DomainResource> {
    return this.database.transaction(async (trx) => {
      await this.tenants.require(tenantId, trx);

      // Scoped to the tenant, so a domain id belonging to somebody else answers exactly as
      // one that does not exist — see `domains.repository.ts`.
      if ((await this.domains.find(tenantId, domainId, trx)) === undefined) {
        throw domainNotFound(domainId);
      }

      if (body.isPrimary) {
        await this.domains.clearPrimary(tenantId, trx);
      }

      const updated = await this.domains.setPrimary(domainId, body.isPrimary, trx);

      if (updated === undefined) {
        throw domainNotFound(domainId);
      }

      return domainResource(updated);
    });
  }

  /**
   * Remove a domain from a tenant.
   *
   * Removing the primary is permitted, for the reason demoting it is: a tenant may legally
   * have none, and refusing would make "replace our domain" an operation with no order that
   * works.
   *
   * @param tenantId - The tenant the domain must belong to.
   * @param domainId - The domain to remove.
   * @returns When it is gone.
   * @throws {NotFoundError} `404 tenant_not_found` or `404 domain_not_found`.
   */
  async remove(tenantId: string, domainId: string): Promise<void> {
    await this.tenants.require(tenantId);

    if (!(await this.domains.remove(tenantId, domainId))) {
      throw domainNotFound(domainId);
    }
  }
}
