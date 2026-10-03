/**
 * The workspace card's reads (BQ.4, [#483](https://github.com/NobuData/ouroboros/issues/483)).
 *
 * The writes to `tenant_domains` are `tenancy/domains.repository.ts`'s statements, reused rather
 * than restated; this file holds only the three lookups the card needs that file does not offer.
 * The organization row is read here and written through the library (`workspace.auth.ts`) — a
 * read of a library table is ours to make, a write is not.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, Organization, TenantDomain } from "../db/schema";
import { queryOn } from "../tenancy/queries";

@Injectable()
export class WorkspaceRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * The workspace's organization row, as it stands now.
   *
   * Read again rather than taken from the tenant guard, so a `PATCH` answers with the name it
   * just wrote.
   *
   * @param organizationId - The workspace.
   * @returns The row, or `undefined` when it is gone.
   */
  async organization(organizationId: string): Promise<Organization | undefined> {
    return this.database.db
      .selectFrom("organization")
      .selectAll()
      .where("id", "=", organizationId)
      .executeTakeFirst();
  }

  /**
   * The workspace's primary domain.
   *
   * @param organizationId - The workspace.
   * @param trx - The transaction to run in, if there is one.
   * @returns The primary row, or `undefined` when the workspace has none.
   */
  async primaryDomain(
    organizationId: string,
    trx?: Transaction<Database>,
  ): Promise<TenantDomain | undefined> {
    return queryOn(this.database, trx)
      .selectFrom("tenant_domains")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("is_primary", "=", true)
      .executeTakeFirst();
  }

  /**
   * One of the workspace's domains, by name.
   *
   * Scoped by workspace, so a domain held by somebody else is not found here — inserting it is
   * what then answers `409 domain_taken`.
   *
   * @param organizationId - The workspace.
   * @param domain - The domain, lower-case.
   * @param trx - The transaction to run in, if there is one.
   * @returns The row, or `undefined`.
   */
  async domainNamed(
    organizationId: string,
    domain: string,
    trx?: Transaction<Database>,
  ): Promise<TenantDomain | undefined> {
    return queryOn(this.database, trx)
      .selectFrom("tenant_domains")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("domain", "=", domain)
      .executeTakeFirst();
  }
}
