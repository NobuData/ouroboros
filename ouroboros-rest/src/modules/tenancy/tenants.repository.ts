/**
 * Every statement this API issues against `ouroboros.tenants`.
 *
 * The shape [#30](https://github.com/NobuData/ouroboros/issues/30) set for a repository, and
 * the reason `DbModule` provides only a connection: the queries belong to the feature module
 * that needs them. A repository holds no rules — "a tenant must keep an owner" is a
 * *service* invariant, and stating it here would put it out of reach of the transaction the
 * service has to enforce it in.
 *
 * Every method takes an optional `trx` and issues its statement through
 * {@link queryOn}, so the same query runs inside a transaction or outside one and the caller
 * decides which.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, Tenant, TenantStatus } from "../db/schema";
import type { PageWindow } from "./pagination";
import { asCount, queryOn } from "./queries";

/** The columns a caller may change. Assembled by the service from a validated body. */
export interface TenantChanges {
  slug?: string;
  display_name?: string;
  status?: TenantStatus;
}

@Injectable()
export class TenantsRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's
   *   lifecycle belongs to `DatabaseService`, and a repository that built its own would hold
   *   connections nothing drains.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One page of tenants, oldest first.
   *
   * Ordered by `created_at` and then `id`. The second term is not decoration: `created_at`
   * is not unique, and two rows sharing one would be free to swap places between queries —
   * so a paginated read could show the same tenant on two pages and never show another. The
   * primary key is the tiebreaker that makes the order total, and every list in this module
   * ends with one for the same reason.
   *
   * @param window - Which rows to return.
   * @param trx - The transaction to run in, if there is one.
   * @returns The rows for this window.
   */
  async list(window: PageWindow, trx?: Transaction<Database>): Promise<Tenant[]> {
    return queryOn(this.database, trx)
      .selectFrom("tenants")
      .selectAll()
      .orderBy("created_at")
      .orderBy("id")
      .limit(window.limit)
      .offset(window.offset)
      .execute();
  }

  /**
   * How many tenants there are.
   *
   * @param trx - The transaction to run in, if there is one.
   * @returns The count, ignoring any window.
   */
  async count(trx?: Transaction<Database>): Promise<number> {
    const { total } = await queryOn(this.database, trx)
      .selectFrom("tenants")
      .select((builder) => builder.fn.countAll<string>().as("total"))
      .executeTakeFirstOrThrow();

    return asCount(total);
  }

  /**
   * Find one tenant.
   *
   * @param id - Its id.
   * @param trx - The transaction to run in, if there is one.
   * @returns The row, or `undefined` when there is none. Deliberately not a throw: whether
   *   an absent tenant is a `404` or an empty list is the caller's question, not a query's.
   */
  async find(id: string, trx?: Transaction<Database>): Promise<Tenant | undefined> {
    return queryOn(this.database, trx)
      .selectFrom("tenants")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /**
   * Create a tenant.
   *
   * @param slug - Its handle. Unique across the installation.
   * @param displayName - What a human reads.
   * @param trx - The transaction to run in, if there is one.
   * @returns The row as the database stored it — id, status and both timestamps included,
   *   every one of which is a default the caller did not supply.
   */
  async create(slug: string, displayName: string, trx?: Transaction<Database>): Promise<Tenant> {
    return queryOn(this.database, trx)
      .insertInto("tenants")
      .values({ slug, display_name: displayName })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Change a tenant.
   *
   * @param id - The tenant to change.
   * @param changes - The columns to set. Never empty: `update … set` with nothing to set is
   *   not a statement, and the service answers a `PATCH` that asked for nothing without
   *   coming here.
   * @param trx - The transaction to run in, if there is one.
   * @returns The updated row, or `undefined` when no tenant has that id — which is how the
   *   service tells "changed nothing" from "there was nothing to change" in one statement
   *   rather than a select and then an update.
   */
  async update(
    id: string,
    changes: TenantChanges,
    trx?: Transaction<Database>,
  ): Promise<Tenant | undefined> {
    return queryOn(this.database, trx)
      .updateTable("tenants")
      .set(changes)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }
}
