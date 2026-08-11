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
 * does not exist before it answers anything about itself. Since
 * [#32](https://github.com/NobuData/ouroboros/issues/32) that `404` also covers "this caller
 * may not know it does" — but not because of anything written here: the tenant guard has
 * already refused a non-member before any service runs, so `require` still answers exactly
 * one question and answers it in one place.
 *
 * {@link TenantsService.list} is the one method in this module that reads the request
 * context ambiently, through `currentUser()`. That is a deliberate exception to how
 * everything else here works — see `tenant.context.ts` on why ambient state is a loaded gun
 * — and the reason it earns it is that *who is asking* is not an input to "list tenants".
 * It is the scope the whole request is happening in, and threading it from a controller
 * through a service to a repository would be the same per-controller plumbing this issue
 * exists to delete.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, Tenant, TenantRole, User } from "../db/schema";
import { MembersRepository } from "./members.repository";
import { windowOf, type Page, type PageQuery } from "./pagination";
import { tenantResource, type TenantResource } from "./resources";
import { pageOf } from "./pagination";
import { currentUser } from "./tenant.context";
import { tenantNotFound } from "./tenancy.errors";
import type { CreateTenantBody, UpdateTenantBody } from "./tenancy.dto";
import { TenantsRepository, type TenantChanges } from "./tenants.repository";

/** What the person who creates a workspace holds in it. */
export const CREATOR_ROLE: TenantRole = "owner";

@Injectable()
export class TenantsService {
  /**
   * @param database - For the one operation here that writes two tables; see {@link create}.
   * @param tenants - The statements against `ouroboros.tenants`.
   * @param members - For the creator's own membership. Tenancy's one cross-repository
   *   dependency, and it is here rather than in `MembersService` because "a workspace has
   *   an owner from the moment it exists" is a rule about *creating a tenant*.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly tenants: TenantsRepository,
    private readonly members: MembersRepository,
  ) {}

  /**
   * List the workspaces the signed-in person belongs to.
   *
   * Scoped to the caller, from the request context. An unscoped listing would hand anybody
   * with a session the name and handle of every customer on the installation, which is a
   * larger existence leak than the `403` this issue replaced with a `404` — and it would be
   * one request rather than a scan.
   *
   * The two statements are issued together rather than one after the other: they are
   * independent, they go to different connections from the same pool, and a list endpoint
   * that waited for a count before asking for rows would be twice as slow for no reason.
   *
   * @param query - The window the client asked for.
   * @returns One page of the caller's tenants — empty when there is no request context at
   *   all, which is not a case the pipeline can produce: the guard establishes the person
   *   before any handler runs. Empty rather than a throw because "no context" is honestly
   *   "no tenants for whoever this is", and a service that threw would turn a background
   *   caller into a `500` instead of an empty page.
   */
  async list(query: PageQuery): Promise<Page<TenantResource>> {
    const window = windowOf(query);
    const user = currentUser();

    if (user === undefined) {
      return pageOf([], 0, window);
    }

    const [rows, total] = await Promise.all([
      this.tenants.listForUser(user.id, window),
      this.tenants.countForUser(user.id),
    ]);

    return pageOf(rows.map(tenantResource), total, window);
  }

  /**
   * Create a tenant, with its creator as owner.
   *
   * Both rows or neither. A tenant with no members is one the tenant guard puts out of
   * reach of everybody including the person who just made it — every route under it answers
   * `404` to a non-member — so a process that died between the two statements would leave a
   * workspace nobody can administer and nobody can delete.
   *
   * A duplicate slug is not checked for. `tenants_slug_key` is the thing that is actually
   * true, and `constraints.ts` turns its refusal into `409 slug_taken` — a check here would
   * be a second, weaker answer with a race between it and the insert. Inside a transaction
   * the refusal rolls the membership back with it.
   *
   * @param creator - The signed-in person. A parameter rather than the ambient context that
   *   {@link list} reads, and the difference is real: who is asking decides what a *listing*
   *   is scoped to, and who becomes the owner is a row this operation writes.
   * @param body - The validated request.
   * @returns The tenant as it was stored.
   */
  async create(creator: User, body: CreateTenantBody): Promise<TenantResource> {
    const tenant = await this.database.transaction(async (trx) => {
      const created = await this.tenants.create(body.slug, body.displayName, trx);

      await this.members.join(created.id, creator.id, CREATOR_ROLE, trx);

      return created;
    });

    return tenantResource(tenant);
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
