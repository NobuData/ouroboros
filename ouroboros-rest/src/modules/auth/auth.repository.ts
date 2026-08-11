/**
 * Every statement sign-in issues — against `users`, `user_identities`, and the two tables a
 * session's answer joins for context.
 *
 * The repository holds statements and no rules, which is the layering
 * [#30](https://github.com/NobuData/ouroboros/issues/30) set and
 * [#31](https://github.com/NobuData/ouroboros/issues/31) followed. Where a person *comes
 * from* — a GitHub identity, an invitation somebody sent them, or nowhere yet — is decided
 * in `auth.service.ts`; this file only knows how to look each of those up and write the
 * row.
 *
 * It overlaps `MembersRepository` in exactly one place, deliberately: both can find a user
 * by address. Tenancy needs it to attach an invitation to a person who may not exist yet;
 * auth needs it to find the person that invitation created. Sharing one repository between
 * the two modules would mean `TenancyModule` and `AuthModule` reaching into each other for
 * a two-line select, and the seam that buys is worth less than the one it costs — see
 * `auth.module.ts`, which imports `DbModule` and not `TenancyModule`.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import { queryOn } from "../tenancy/queries";
import type { Database, IdentityProvider, NewUser, Tenant, User } from "../db/schema";
import type { MembershipRow } from "./auth.resources";

/** The provider every identity this module writes carries. */
export const GITHUB_PROVIDER: IdentityProvider = "github";

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
   * Find the person behind an external account.
   *
   * The only lookup that answers "have I seen this GitHub account before", and so the one
   * that makes a repeat sign-in reuse a `users` row rather than create a second one.
   * Keyed on `(provider, external_id)` — V002's unique index — rather than on the login,
   * which a person may change at any time.
   *
   * @param provider - Which external system. `github` today; the column is a union type
   *   because V002 uses a check constraint rather than an enum, so a second provider is an
   *   ordinary migration.
   * @param externalId - The provider's immutable id for the account.
   * @param trx - The transaction to run in, if there is one.
   * @returns The person, or `undefined` when this account has never signed in here.
   */
  async findUserByIdentity(
    provider: IdentityProvider,
    externalId: string,
    trx?: Transaction<Database>,
  ): Promise<User | undefined> {
    return queryOn(this.database, trx)
      .selectFrom("user_identities")
      .innerJoin("users", "users.id", "user_identities.user_id")
      .selectAll("users")
      .where("user_identities.provider", "=", provider)
      .where("user_identities.external_id", "=", externalId)
      .executeTakeFirst();
  }

  /**
   * Find a person by their address.
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
   * Create a person.
   *
   * @param values - Their address, name and avatar. The address must already be
   *   lower-cased; V002 stores it folded and this repository does not fold it for a caller,
   *   because a repository that quietly rewrote a value would hide the one place the rule
   *   belongs.
   * @param trx - The transaction to run in, if there is one.
   * @returns The stored row.
   */
  async createUser(values: NewUser, trx?: Transaction<Database>): Promise<User> {
    return queryOn(this.database, trx)
      .insertInto("users")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Refresh what GitHub knows about a person.
   *
   * Their name and avatar only. The address is deliberately not updated here: it is
   * `users_email_key`-unique and is what an outstanding invitation was addressed to, so
   * changing it on every sign-in would let a GitHub-side address change collide with
   * another row — or silently detach somebody from an invitation. Reconciling a changed
   * primary address is a settings-screen decision with a person in the loop, not a side
   * effect of signing in.
   *
   * @param id - Whose row.
   * @param displayName - What GitHub calls them now.
   * @param avatarUrl - Their avatar, or `null`.
   * @param trx - The transaction to run in, if there is one.
   * @returns The row after the change.
   */
  async refreshProfile(
    id: string,
    displayName: string,
    avatarUrl: string | null,
    trx?: Transaction<Database>,
  ): Promise<User> {
    return queryOn(this.database, trx)
      .updateTable("users")
      .set({ display_name: displayName, avatar_url: avatarUrl })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Record that a person controls an external account.
   *
   * Holds no token and no secret, and none may be added:
   * `ouroboros-db/tests/constraints.sql` reads `information_schema` and fails if a column
   * whose name looks like a credential ever appears on this table.
   *
   * @param userId - The person.
   * @param provider - Which external system.
   * @param externalId - The provider's immutable id.
   * @param trx - The transaction to run in, if there is one.
   * @returns When the row exists.
   */
  async linkIdentity(
    userId: string,
    provider: IdentityProvider,
    externalId: string,
    trx?: Transaction<Database>,
  ): Promise<void> {
    await queryOn(this.database, trx)
      .insertInto("user_identities")
      .values({ user_id: userId, provider, external_id: externalId })
      .execute();
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
