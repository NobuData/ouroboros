/**
 * The rules about a workspace's email domains — one of which needs a transaction.
 *
 * `tenant_domains_one_primary_per_organization` is a partial unique index over the rows where
 * `is_primary` is true (V001, re-scoped by V006), so "make this one primary" cannot be a
 * single `update`: the row that holds the flag has to give it up first, and between the two
 * statements the index would refuse a second primary. Both statements therefore run inside
 * `DatabaseService.transaction`, which is also what makes the intermediate state — a workspace
 * with no primary domain at all — invisible to every other connection.
 *
 * **Nothing here checks that the workspace exists**, and that is a deletion rather than an
 * omission. Every one of these operations used to begin by requiring the tenant through
 * `TenantsService`; since [#713](https://github.com/NobuData/ouroboros/issues/713) the tenant
 * guard resolves `{orgId}` before any handler runs and answers the same `404` for a workspace
 * that does not exist *and* for one the caller is not a member of — so a second check here
 * would be a second place that rule could be written differently, which is precisely what #32
 * asked for it to stop being. `constraints.ts` still maps the foreign key, which covers the
 * only case the guard cannot: a workspace deleted between the guard and the write.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import { DomainsRepository } from "./domains.repository";
import { pageOf, windowOf, type Page, type PageQuery } from "./pagination";
import { domainResource, type DomainResource } from "./resources";
import type { CreateDomainBody, UpdateDomainBody } from "./tenancy.dto";
import { domainNotFound } from "./tenancy.errors";

@Injectable()
export class DomainsService {
  constructor(
    private readonly domains: DomainsRepository,
    private readonly database: DatabaseService,
  ) {}

  /**
   * List a workspace's domains.
   *
   * @param organizationId - Whose domains.
   * @param query - The window the client asked for.
   * @returns One page of domains, the primary first.
   */
  async list(organizationId: string, query: PageQuery): Promise<Page<DomainResource>> {
    const window = windowOf(query);
    const [rows, total] = await Promise.all([
      this.domains.list(organizationId, window),
      this.domains.count(organizationId),
    ]);

    return pageOf(rows.map(domainResource), total, window);
  }

  /**
   * Add a domain to a workspace.
   *
   * Adding one *as* the primary is the two-statement case, so the whole operation runs in a
   * transaction whenever `isPrimary` is asked for.
   *
   * @param organizationId - The owning workspace.
   * @param body - The validated request.
   * @returns The domain as it was stored.
   * @throws {ConflictError} `409 domain_taken` when the domain is already another workspace's
   *   — raised by `tenant_domains_domain_key`, mapped by `constraints.ts`. This is the worked
   *   example of a constraint violation becoming an answer, and V006 preserved that index
   *   untouched because `POST /api/v1/auth/discover` reads it (#712).
   */
  async add(organizationId: string, body: CreateDomainBody): Promise<DomainResource> {
    const isPrimary = body.isPrimary ?? false;

    return this.database.transaction(async (trx) => {
      if (isPrimary) {
        await this.domains.clearPrimary(organizationId, trx);
      }

      return domainResource(await this.domains.create(organizationId, body.domain, isPrimary, trx));
    });
  }

  /**
   * Promote a domain to primary, or demote it.
   *
   * Demotion is allowed to leave the workspace with no primary at all: V001 permits zero, and
   * a workspace part-way through changing which domain it presents is a real state rather than
   * one to refuse.
   *
   * @param organizationId - The workspace the domain must belong to.
   * @param domainId - The domain to change.
   * @param body - The validated request.
   * @returns The domain after the change.
   * @throws {NotFoundError} `404 domain_not_found`.
   */
  async setPrimary(
    organizationId: string,
    domainId: string,
    body: UpdateDomainBody,
  ): Promise<DomainResource> {
    return this.database.transaction(async (trx) => {
      // Scoped to the workspace, so a domain id belonging to somebody else answers exactly as
      // one that does not exist — see `domains.repository.ts`.
      if ((await this.domains.find(organizationId, domainId, trx)) === undefined) {
        throw domainNotFound(domainId);
      }

      if (body.isPrimary) {
        await this.domains.clearPrimary(organizationId, trx);
      }

      const updated = await this.domains.setPrimary(domainId, body.isPrimary, trx);

      if (updated === undefined) {
        throw domainNotFound(domainId);
      }

      return domainResource(updated);
    });
  }

  /**
   * Remove a domain from a workspace.
   *
   * Removing the primary is permitted, for the reason demoting it is: a workspace may legally
   * have none, and refusing would make "replace our domain" an operation with no order that
   * works.
   *
   * @param organizationId - The workspace the domain must belong to.
   * @param domainId - The domain to remove.
   * @returns When it is gone.
   * @throws {NotFoundError} `404 domain_not_found`.
   */
  async remove(organizationId: string, domainId: string): Promise<void> {
    if (!(await this.domains.remove(organizationId, domainId))) {
      throw domainNotFound(domainId);
    }
  }
}
