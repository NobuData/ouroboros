/**
 * What a tenant *is*, as rules rather than as statements.
 *
 * The service layer is where "no such tenant" becomes a `404`, where an empty `PATCH` is
 * answered without a statement being issued, and where a row becomes the resource a client
 * reads. The repository below it knows none of that, and the controller above it knows only
 * how to hand over a validated request.
 *
 * {@link TenantsService.require} is the piece the rest of the module is built on: every
 * nested resource — domains, members, organisations — has to answer `404` for a tenant that
 * does not exist before it answers anything about itself, and doing that in one place is
 * what will make it one edit when [#32](https://github.com/NobuData/ouroboros/issues/32)
 * widens "does not exist" to include "this caller may not know it does".
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import type { Database, Tenant } from "../db/schema";
import { windowOf, type Page, type PageQuery } from "./pagination";
import { tenantResource, type TenantResource } from "./resources";
import { pageOf } from "./pagination";
import { tenantNotFound } from "./tenancy.errors";
import type { CreateTenantBody, UpdateTenantBody } from "./tenancy.dto";
import { TenantsRepository, type TenantChanges } from "./tenants.repository";

@Injectable()
export class TenantsService {
  constructor(private readonly tenants: TenantsRepository) {}

  /**
   * List tenants.
   *
   * The two statements are issued together rather than one after the other: they are
   * independent, they go to different connections from the same pool, and a list endpoint
   * that waited for a count before asking for rows would be twice as slow for no reason.
   *
   * @param query - The window the client asked for.
   * @returns One page of tenants.
   */
  async list(query: PageQuery): Promise<Page<TenantResource>> {
    const window = windowOf(query);
    const [rows, total] = await Promise.all([this.tenants.list(window), this.tenants.count()]);

    return pageOf(rows.map(tenantResource), total, window);
  }

  /**
   * Create a tenant.
   *
   * A duplicate slug is not checked for. `tenants_slug_key` is the thing that is actually
   * true, and `constraints.ts` turns its refusal into `409 slug_taken` — a check here would
   * be a second, weaker answer with a race between it and the insert.
   *
   * @param body - The validated request.
   * @returns The tenant as it was stored.
   */
  async create(body: CreateTenantBody): Promise<TenantResource> {
    return tenantResource(await this.tenants.create(body.slug, body.displayName));
  }

  /**
   * Read one tenant.
   *
   * @param tenantId - Which one.
   * @returns Its representation.
   * @throws {NotFoundError} `404 tenant_not_found` when there is no such tenant.
   */
  async read(tenantId: string): Promise<TenantResource> {
    return tenantResource(await this.require(tenantId));
  }

  /**
   * Change a tenant.
   *
   * A body naming no field is answered with the tenant unchanged rather than refused. That
   * is what `PATCH` means — apply these changes, of which there are none — and the
   * alternative is a `422` for a request that asked for nothing and got it.
   *
   * @param tenantId - Which tenant.
   * @param body - The validated request. Every field optional.
   * @returns The tenant after the change.
   * @throws {NotFoundError} `404 tenant_not_found` when there is no such tenant.
   * @throws {ConflictError} `409 slug_taken` when the new slug is another tenant's — raised
   *   by the unique index, mapped by `constraints.ts`.
   */
  async update(tenantId: string, body: UpdateTenantBody): Promise<TenantResource> {
    const changes = changesFrom(body);

    if (Object.keys(changes).length === 0) {
      return tenantResource(await this.require(tenantId));
    }

    const updated = await this.tenants.update(tenantId, changes);

    if (updated === undefined) {
      throw tenantNotFound(tenantId);
    }

    return tenantResource(updated);
  }

  /**
   * The tenant, or a `404`.
   *
   * Public because it is the guard every nested resource in this module runs first: a
   * request for the domains of a tenant that does not exist is a `404` about the tenant, not
   * an empty list.
   *
   * @param tenantId - Which tenant.
   * @param trx - The transaction to look in, when the caller is inside one. Passing it
   *   matters: a check issued on the pool cannot see rows the open transaction has written,
   *   and would answer about a tenant the transaction has already changed.
   * @returns The row.
   * @throws {NotFoundError} `404 tenant_not_found` when there is none.
   */
  async require(tenantId: string, trx?: Transaction<Database>): Promise<Tenant> {
    const tenant = await this.tenants.find(tenantId, trx);

    if (tenant === undefined) {
      throw tenantNotFound(tenantId);
    }

    return tenant;
  }
}

/**
 * The columns a `PATCH` asked to change.
 *
 * Built by naming each field rather than by spreading the body, because the body's property
 * names are the API's and the columns' are the database's — and because a spread would
 * happily carry a property the DTO gained later into an `update … set`.
 *
 * @param body - The validated request.
 * @returns Only the columns the request actually named. An absent field is left alone; there
 *   is deliberately no way to *clear* one, since none of the three is nullable.
 */
function changesFrom(body: UpdateTenantBody): TenantChanges {
  const changes: TenantChanges = {};

  if (body.slug !== undefined) {
    changes.slug = body.slug;
  }

  if (body.displayName !== undefined) {
    changes.display_name = body.displayName;
  }

  if (body.status !== undefined) {
    changes.status = body.status;
  }

  return changes;
}
