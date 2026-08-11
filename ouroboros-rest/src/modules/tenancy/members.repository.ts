/**
 * Every statement this API issues against `ouroboros.tenant_members` and the `users` rows a
 * membership names.
 *
 * Two tables in one repository, deliberately. A membership without the person is a pair of
 * uuids and a role, and every screen that reads one reads the name, the address and the
 * avatar beside it — so the join *is* the resource (`resources.ts`, {@link MemberRow}), and
 * splitting it across two repositories would mean every caller performing the join by hand.
 * `users` has no repository of its own for the same reason it has no API surface here: the
 * only thing tenancy does to a person is find them or create the stub of one, and
 * [#33](https://github.com/NobuData/ouroboros/issues/33) is what owns them properly.
 *
 * {@link ownerIdsForUpdate} is the one method here that is not an ordinary read. It exists
 * because "a tenant must keep an owner" spans rows, and a rule that spans rows is only true
 * if the rows are locked while it is checked — see `members.service.ts`.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, TenantRole, User } from "../db/schema";
import type { PageWindow } from "./pagination";
import { asCount, queryOn } from "./queries";
import type { MemberRow } from "./resources";

/** The role that may not be left unheld. */
export const OWNER: TenantRole = "owner";

/** The columns a membership listing selects, in the order the join returns them. */
const MEMBER_COLUMNS = [
  "tenant_members.tenant_id",
  "tenant_members.user_id",
  "users.email",
  "users.display_name",
  "users.avatar_url",
  "tenant_members.role",
  "tenant_members.invited_at",
  "tenant_members.joined_at",
] as const;

@Injectable()
export class MembersRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * One page of a tenant's members, by name.
   *
   * `display_name` then `user_id`: the name is what mockup 17's table is sorted by, and the
   * id is the tiebreaker that keeps the order total when two people share a name.
   *
   * @param tenantId - Whose members.
   * @param window - Which rows to return.
   * @param trx - The transaction to run in, if there is one.
   * @returns The rows for this window, each joined to its person.
   */
  async list(
    tenantId: string,
    window: PageWindow,
    trx?: Transaction<Database>,
  ): Promise<MemberRow[]> {
    return queryOn(this.database, trx)
      .selectFrom("tenant_members")
      .innerJoin("users", "users.id", "tenant_members.user_id")
      .select(MEMBER_COLUMNS)
      .where("tenant_members.tenant_id", "=", tenantId)
      .orderBy("users.display_name")
      .orderBy("tenant_members.user_id")
      .limit(window.limit)
      .offset(window.offset)
      .execute();
  }

  /**
   * How many members a tenant has.
   *
   * @param tenantId - Whose members.
   * @param trx - The transaction to run in, if there is one.
   * @returns The count, ignoring any window.
   */
  async count(tenantId: string, trx?: Transaction<Database>): Promise<number> {
    const { total } = await queryOn(this.database, trx)
      .selectFrom("tenant_members")
      .select((builder) => builder.fn.countAll<string>().as("total"))
      .where("tenant_id", "=", tenantId)
      .executeTakeFirstOrThrow();

    return asCount(total);
  }

  /**
   * Find one membership, joined to its person.
   *
   * @param tenantId - The tenant.
   * @param userId - The person.
   * @param trx - The transaction to run in, if there is one.
   * @returns The row, or `undefined` when this person is not a member of this tenant.
   */
  async find(
    tenantId: string,
    userId: string,
    trx?: Transaction<Database>,
  ): Promise<MemberRow | undefined> {
    return queryOn(this.database, trx)
      .selectFrom("tenant_members")
      .innerJoin("users", "users.id", "tenant_members.user_id")
      .select(MEMBER_COLUMNS)
      .where("tenant_members.tenant_id", "=", tenantId)
      .where("tenant_members.user_id", "=", userId)
      .executeTakeFirst();
  }

  /**
   * The tenants a person belongs to, by id, up to a limit.
   *
   * The sole-membership fallback in `tenant.resolver.ts`, and nothing else: it asks for two
   * rows and treats one as an answer. Ids only, and ordered, because the caller needs to
   * know *whether there is exactly one* and *which* — and an unordered `limit 2` over a
   * person in fifty workspaces would return a different pair between requests.
   *
   * @param userId - Whose memberships.
   * @param limit - How many to read. The caller passes the smallest number that can answer
   *   its question.
   * @param trx - The transaction to run in, if there is one.
   * @returns The tenant ids, oldest membership first.
   */
  async tenantIdsFor(
    userId: string,
    limit: number,
    trx?: Transaction<Database>,
  ): Promise<string[]> {
    const rows = await queryOn(this.database, trx)
      .selectFrom("tenant_members")
      .select("tenant_id")
      .where("user_id", "=", userId)
      .orderBy("invited_at")
      .orderBy("tenant_id")
      .limit(limit)
      .execute();

    return rows.map((row) => row.tenant_id);
  }

  /**
   * Who currently owns this tenant, with those rows locked until the transaction ends.
   *
   * This is the whole of how the last-owner rule is made true. A plain `select count(*)`
   * answers a question about a moment that has already passed: two requests demoting two
   * different owners can both read "two owners", both decide they are not the last, and
   * leave the tenant with none. `for update` makes the second wait for the first to commit
   * and then re-read, so one of them sees a single owner and is refused.
   *
   * Ids rather than a count, because PostgreSQL will not lock the rows behind an aggregate —
   * `FOR UPDATE is not allowed with aggregate functions` — and because the caller needs to
   * know *which* owner, not only how many.
   *
   * @param tenantId - The tenant to lock the owners of.
   * @param trx - The transaction the lock is held for. Not optional: a lock taken outside a
   *   transaction is released by the next statement, which is the bug this method exists to
   *   prevent.
   * @returns The user ids holding `owner`, locked.
   */
  async ownerIdsForUpdate(tenantId: string, trx: Transaction<Database>): Promise<string[]> {
    const rows = await trx
      .selectFrom("tenant_members")
      .select("user_id")
      .where("tenant_id", "=", tenantId)
      .where("role", "=", OWNER)
      .forUpdate()
      .execute();

    return rows.map((row) => row.user_id);
  }

  /**
   * Find a person by their address.
   *
   * @param email - The address, already lower-cased. `users_email_key` is a plain unique
   *   index over a folded column, so this is an index scan and a differently-cased address
   *   would silently miss.
   * @param trx - The transaction to run in, if there is one.
   * @returns The person, or `undefined` when Ouroboros has never heard of them.
   */
  async findUserByEmail(email: string, trx?: Transaction<Database>): Promise<User | undefined> {
    return queryOn(this.database, trx)
      .selectFrom("users")
      .selectAll()
      .where("email", "=", email)
      .executeTakeFirst();
  }

  /**
   * Create the stub of a person who has never signed in.
   *
   * Everything else about them — their avatar, their real name, the GitHub identity they
   * authenticate with — arrives when they do, in
   * [#33](https://github.com/NobuData/ouroboros/issues/33). This row exists so a membership
   * has something to point at in the meantime, which is what makes an invitation to somebody
   * with no account representable at all.
   *
   * @param email - Their address, lower-cased.
   * @param displayName - What to call them until they say otherwise.
   * @param trx - The transaction to run in, if there is one.
   * @returns The stored row.
   */
  async createUser(email: string, displayName: string, trx?: Transaction<Database>): Promise<User> {
    return queryOn(this.database, trx)
      .insertInto("users")
      .values({ email, display_name: displayName })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Record a membership.
   *
   * `joined_at` is left null: the row is an invitation until the person accepts it, and
   * nothing before their first sign-in can honestly say they have.
   *
   * @param tenantId - The tenant they are joining.
   * @param userId - The person.
   * @param role - What they may do.
   * @param trx - The transaction to run in, if there is one.
   * @returns When the row exists. The service reads it back through {@link find}, because the
   *   resource carries the person's own columns and an `insert … returning` over
   *   `tenant_members` alone cannot.
   */
  async invite(
    tenantId: string,
    userId: string,
    role: TenantRole,
    trx?: Transaction<Database>,
  ): Promise<void> {
    await queryOn(this.database, trx)
      .insertInto("tenant_members")
      .values({ tenant_id: tenantId, user_id: userId, role })
      .execute();
  }

  /**
   * Record a membership that is already accepted.
   *
   * The counterpart to {@link invite}, and the difference is `joined_at`: an invitation is
   * outstanding until the person accepts it, and somebody who has just *created* the
   * workspace has plainly accepted. Used by exactly one caller — `tenants.service.ts`,
   * making the creator its owner ([#32](https://github.com/NobuData/ouroboros/issues/32)) —
   * because a workspace with no members is one the `404` rule puts out of reach of the
   * person who made it.
   *
   * `joined_at` is `now()` rather than a `Date` this process made, and the reason is a check
   * constraint: V002 declares `joined_at >= invited_at`, `invited_at` defaults to the
   * server's `now()`, and `now()` in PostgreSQL is the *transaction's* start. A timestamp
   * from this process's clock is therefore compared against a clock in another container —
   * and when the application's runs a few milliseconds behind, the row is refused. Both
   * columns come from one clock instead, so they are equal by construction.
   *
   * @param tenantId - The tenant.
   * @param userId - The person.
   * @param role - What they may do.
   * @param trx - The transaction to run in, if there is one.
   * @returns When the row exists.
   */
  async join(
    tenantId: string,
    userId: string,
    role: TenantRole,
    trx?: Transaction<Database>,
  ): Promise<void> {
    await queryOn(this.database, trx)
      .insertInto("tenant_members")
      .values({ tenant_id: tenantId, user_id: userId, role, joined_at: sql<Date>`now()` })
      .execute();
  }

  /**
   * Change what a member may do.
   *
   * @param tenantId - The tenant.
   * @param userId - The member.
   * @param role - Their new role.
   * @param trx - The transaction to run in, if there is one.
   * @returns Whether a row was changed — `false` when they are not a member.
   */
  async setRole(
    tenantId: string,
    userId: string,
    role: TenantRole,
    trx?: Transaction<Database>,
  ): Promise<boolean> {
    const result = await queryOn(this.database, trx)
      .updateTable("tenant_members")
      .set({ role })
      .where("tenant_id", "=", tenantId)
      .where("user_id", "=", userId)
      .executeTakeFirst();

    return asCount(result.numUpdatedRows) > 0;
  }

  /**
   * Remove a membership.
   *
   * The person survives it. They may hold roles in other tenants, and V002's whole reason for
   * making `users` global is that one human is one row however many workspaces they belong to.
   *
   * @param tenantId - The tenant.
   * @param userId - The member to remove.
   * @param trx - The transaction to run in, if there is one.
   * @returns Whether a row was removed.
   */
  async remove(tenantId: string, userId: string, trx?: Transaction<Database>): Promise<boolean> {
    const result = await queryOn(this.database, trx)
      .deleteFrom("tenant_members")
      .where("tenant_id", "=", tenantId)
      .where("user_id", "=", userId)
      .executeTakeFirst();

    return asCount(result.numDeletedRows) > 0;
  }
}
