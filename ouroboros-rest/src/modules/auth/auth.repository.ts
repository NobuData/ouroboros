/**
 * Every statement this module issues — against `users`, and the two tables a session's
 * answer joins for context.
 *
 * The repository holds statements and no rules, which is the layering
 * [#30](https://github.com/NobuData/ouroboros/issues/30) set and
 * [#31](https://github.com/NobuData/ouroboros/issues/31) followed.
 *
 * **It no longer writes anything.** #33's sign-in wrote `users` and `user_identities`
 * through this file — `findUserByIdentity`, `createUser`, `refreshProfile` and
 * `linkIdentity` — and [#702](https://github.com/NobuData/ouroboros/issues/702) deleted all
 * four along with the flow that called them. BetterAuth owns the identity model now, and
 * writes `"user"` and `account` through its own adapter over the same pool
 * (`src/auth/auth.options.ts`).
 *
 * **And it no longer reads a person, either.**
 * [#703](https://github.com/NobuData/ouroboros/issues/703) took `findUserById` and
 * `findUserByEmail` with the guard and the development bypass that were their only callers:
 * the signed-in person now arrives with the session the library resolved, so reading a
 * `users` row to confirm them would be a query per request — the cost the cookie cache
 * exists to remove — and would find nothing at all for anybody who first signed in after
 * V004, since such a person has a `"user"` row and no `users` row. See `principal.ts`.
 *
 * What is left are the two reads that answer `GET /api/v1/auth/me`: the caller's
 * memberships, and the tenant their address's domain points at. Both are about *tenancy*
 * rather than identity, which is why they outlive the identity model that used to be here
 * and why this module still imports `DbModule` rather than `TenancyModule` — see
 * `auth.module.ts`.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import { queryOn } from "../tenancy/queries";
import type { Database, Tenant } from "../db/schema";
import type { MembershipRow } from "./auth.resources";

/** The columns a membership listing selects, in the order the join returns them. */
const MEMBERSHIP_COLUMNS = [
  "tenant_members.tenant_id",
  "tenants.slug",
  "tenants.display_name",
  "tenants.status",
  "tenant_members.role",
  "tenant_members.invited_at",
  "tenant_members.joined_at",
] as const;

@Injectable()
export class AuthRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every tenant a person belongs to, with the role they hold there.
   *
   * Ordered by the tenant's name and then its id, so a workspace switcher renders the same
   * order twice running and two tenants sharing a name cannot swap places.
   *
   * @param userId - Whose memberships.
   * @param trx - The transaction to run in, if there is one.
   * @returns One row per membership. Empty for somebody who has signed in and belongs to
   *   nothing yet, which is the state the tenant suggestion below exists for.
   */
  async listMemberships(userId: string, trx?: Transaction<Database>): Promise<MembershipRow[]> {
    return queryOn(this.database, trx)
      .selectFrom("tenant_members")
      .innerJoin("tenants", "tenants.id", "tenant_members.tenant_id")
      .select(MEMBERSHIP_COLUMNS)
      .where("tenant_members.user_id", "=", userId)
      .orderBy("tenants.display_name")
      .orderBy("tenant_members.tenant_id")
      .execute();
  }

  /**
   * The tenant an email domain resolves to, if one does.
   *
   * V001 makes `tenant_domains.domain` globally unique and lower-cased, so one domain names
   * exactly one tenant and this is an index scan. It is a *suggestion* and nothing more —
   * matching a domain grants no membership and no access, and the row this finds is
   * rendered by [#44](https://github.com/NobuData/ouroboros/issues/44) as "your
   * organisation is already on Ouroboros; ask an owner to add you".
   *
   * @param domain - The part of an address after the `@`, lower-cased.
   * @param trx - The transaction to run in, if there is one.
   * @returns The tenant, or `undefined` when no tenant claims that domain.
   */
  async findTenantByDomain(
    domain: string,
    trx?: Transaction<Database>,
  ): Promise<Tenant | undefined> {
    return queryOn(this.database, trx)
      .selectFrom("tenant_domains")
      .innerJoin("tenants", "tenants.id", "tenant_domains.tenant_id")
      .selectAll("tenants")
      .where("tenant_domains.domain", "=", domain)
      .executeTakeFirst();
  }
}
