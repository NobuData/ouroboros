/**
 * Every statement this API issues against `ouroboros.tenant_domains`.
 *
 * The table keeps its V001 name and its snake_case, and hangs off `organization_id` since
 * V006 ([#708](https://github.com/NobuData/ouroboros/issues/708)) — decision A4: our table,
 * our style, whichever table it is parented onto.
 *
 * One thing about it shapes the whole file: `tenant_domains_one_primary_per_organization`
 * is a *partial* unique index over the rows where `is_primary` is true, so promoting a
 * domain is two statements — demote whatever holds it, promote this one — and the index
 * refuses the intermediate state if they are not in the same transaction. Every method that
 * can touch `is_primary` therefore takes a `trx`, and `domains.service.ts` is what supplies
 * one.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, TenantDomain } from "../db/schema";
import type { PageWindow } from "./pagination";
import { asCount, queryOn } from "./queries";

@Injectable()
export class DomainsRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * One page of a workspace's domains — the primary first, then alphabetically.
   *
   * The order is the settings screen's: the domain the product displays back is the one a
   * reader looks for, so it is at the top rather than wherever its creation time put it.
   *
   * @param organizationId - Whose domains.
   * @param window - Which rows to return.
   * @param trx - The transaction to run in, if there is one.
   * @returns The rows for this window.
   */
  async list(
    organizationId: string,
    window: PageWindow,
    trx?: Transaction<Database>,
  ): Promise<TenantDomain[]> {
    return queryOn(this.database, trx)
      .selectFrom("tenant_domains")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .orderBy("is_primary", "desc")
      .orderBy("domain")
      .limit(window.limit)
      .offset(window.offset)
      .execute();
  }

  /**
   * How many domains a workspace has.
   *
   * @param organizationId - Whose domains.
   * @param trx - The transaction to run in, if there is one.
   * @returns The count, ignoring any window.
   */
  async count(organizationId: string, trx?: Transaction<Database>): Promise<number> {
    const { total } = await queryOn(this.database, trx)
      .selectFrom("tenant_domains")
      .select((builder) => builder.fn.countAll<string>().as("total"))
      .where("organization_id", "=", organizationId)
      .executeTakeFirstOrThrow();

    return asCount(total);
  }

  /**
   * Find one of a workspace's domains.
   *
   * Scoped by workspace deliberately: a domain id that exists under a *different* workspace must
   * answer exactly as one that exists nowhere, or the API tells whoever asked which
   * identifiers are real.
   *
   * @param organizationId - The workspace the domain must belong to.
   * @param domainId - The domain's id.
   * @param trx - The transaction to run in, if there is one.
   * @returns The row, or `undefined`.
   */
  async find(
    organizationId: string,
    domainId: string,
    trx?: Transaction<Database>,
  ): Promise<TenantDomain | undefined> {
    return queryOn(this.database, trx)
      .selectFrom("tenant_domains")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", domainId)
      .executeTakeFirst();
  }

  /**
   * Add a domain to a workspace.
   *
   * @param organizationId - The owning workspace.
   * @param domain - The domain, already lower-cased by its DTO.
   * @param isPrimary - Whether this becomes the displayed domain. The caller must have
   *   demoted the current primary in the same transaction when this is `true`.
   * @param trx - The transaction to run in, if there is one.
   * @returns The stored row.
   */
  async create(
    organizationId: string,
    domain: string,
    isPrimary: boolean,
    trx?: Transaction<Database>,
  ): Promise<TenantDomain> {
    return queryOn(this.database, trx)
      .insertInto("tenant_domains")
      .values({ organization_id: organizationId, domain, is_primary: isPrimary })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Set or clear one domain's primary flag.
   *
   * @param domainId - The domain to change.
   * @param isPrimary - What to set it to.
   * @param trx - The transaction to run in, if there is one.
   * @returns The updated row, or `undefined` when no domain has that id.
   */
  async setPrimary(
    domainId: string,
    isPrimary: boolean,
    trx?: Transaction<Database>,
  ): Promise<TenantDomain | undefined> {
    return queryOn(this.database, trx)
      .updateTable("tenant_domains")
      .set({ is_primary: isPrimary })
      .where("id", "=", domainId)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Demote whichever of a workspace's domains is currently primary.
   *
   * Written as one statement over `where is_primary` rather than as a read followed by an
   * update of the id it found: the index guarantees there is at most one such row, and doing
   * it in a single statement is what makes the promotion below race-free inside a
   * transaction.
   *
   * @param organizationId - Whose primary to clear.
   * @param trx - The transaction to run in. Required in practice — see this file's header.
   * @returns When the statement has run. Nothing to report: zero rows is the normal case for
   *   a workspace mid-setup, which V001 permits.
   */
  async clearPrimary(organizationId: string, trx?: Transaction<Database>): Promise<void> {
    await queryOn(this.database, trx)
      .updateTable("tenant_domains")
      .set({ is_primary: false })
      .where("organization_id", "=", organizationId)
      .where("is_primary", "=", true)
      .execute();
  }

  /**
   * Remove a domain from a workspace.
   *
   * @param organizationId - The workspace the domain must belong to.
   * @param domainId - The domain to remove.
   * @param trx - The transaction to run in, if there is one.
   * @returns Whether a row was removed. `false` means the domain did not exist *for this
   *   workspace*, which the service answers `404` to.
   */
  async remove(
    organizationId: string,
    domainId: string,
    trx?: Transaction<Database>,
  ): Promise<boolean> {
    const result = await queryOn(this.database, trx)
      .deleteFrom("tenant_domains")
      .where("organization_id", "=", organizationId)
      .where("id", "=", domainId)
      .executeTakeFirst();

    return asCount(result.numDeletedRows) > 0;
  }
}
