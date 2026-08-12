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
 * (`src/auth/auth.options.ts`). What is left here are four reads, and the two that survive
 * [#703](https://github.com/NobuData/ouroboros/issues/703) are the two that answer
 * `GET /api/v1/auth/me`.
 *
 * It overlaps `MembersRepository` in exactly one place, deliberately: both can find a user
 * by address. Tenancy needs it to attach an invitation to a person who may not exist yet;
 * auth needs it for the development bypass. Sharing one repository between the two modules
 * would mean `TenancyModule` and `AuthModule` reaching into each other for a two-line
 * select, and the seam that buys is worth less than the one it costs — see
 * `auth.module.ts`, which imports `DbModule` and not `TenancyModule`.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import { queryOn } from "../tenancy/queries";
import type { Database, Tenant, User } from "../db/schema";
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
   * Find a person by their address.
   *
   * Read by the development bypass, which is the only caller left: #33's sign-in used this
   * to attach an arriving GitHub identity to a stub row an invitation had created, and
   * BetterAuth's account linking is what does that now
   * (`src/auth/github.provider.ts`). It goes with the bypass in
   * [#705](https://github.com/NobuData/ouroboros/issues/705).
   *
   * @param email - The address, already lower-cased. `users_email_key` indexes the stored
   *   column, so a differently-cased address would silently miss.
   * @param trx - The transaction to run in, if there is one.
   * @returns The person, or `undefined`.
   */
  async findUserByEmail(email: string, trx?: Transaction<Database>): Promise<User | undefined> {
    return queryOn(this.database, trx)
      .selectFrom("users")
      .selectAll()
      .where("email", "=", email)
      .executeTakeFirst();
  }

  /**
   * Find a person by id.
   *
   * Issued on every authenticated request, by the session guard, which is why it is a
   * primary-key lookup and nothing more. Reading the row rather than trusting the cookie
   * is what makes a deleted user's outstanding session stop working immediately — see
   * `session.ts` on why the cookie carries an id and not a copy of the person.
   *
   * @param id - `ouroboros.users.id`.
   * @param trx - The transaction to run in, if there is one.
   * @returns The person, or `undefined` when the row is gone.
   */
  async findUserById(id: string, trx?: Transaction<Database>): Promise<User | undefined> {
    return queryOn(this.database, trx)
      .selectFrom("users")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

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
