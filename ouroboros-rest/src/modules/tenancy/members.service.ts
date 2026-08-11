/**
 * Membership, and the one invariant `ouroboros-db` deliberately does not enforce.
 *
 * V002's header says it outright: *a tenant always retains at least one `owner` … cannot be
 * written as a constraint — it spans rows and must survive both a role change and a delete —
 * so it is a trigger or an application invariant, and it belongs with the tenancy API (#31)
 * that will be the only thing allowed to write here.* This file is where that promise is
 * kept, and {@link MembersService.demotionWouldOrphan} is the whole of it.
 *
 * It is enforced with a lock rather than with a count, and the difference is the difference
 * between an invariant and a comment. Two requests demoting two different owners of a
 * two-owner tenant can both read "two owners", both conclude they are not the last, and
 * commit — leaving a tenant nobody administers, from two requests each of which was correct
 * on its own. `select … for update` (`members.repository.ts`) makes the second wait for the
 * first and then see one owner, which is the answer it should have had.
 *
 * The other thing to know about this file is that inviting somebody creates *two* rows in
 * one transaction: the person, if Ouroboros has never heard of them, and their membership.
 * The invitation is a stub, as the issue names it — nothing is sent, `joined_at` stays null,
 * and [#33](https://github.com/NobuData/ouroboros/issues/33)'s OAuth callback is the first
 * thing that can honestly say they accepted.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, TenantRole } from "../db/schema";
import { MembersRepository, OWNER } from "./members.repository";
import { pageOf, windowOf, type Page, type PageQuery } from "./pagination";
import { memberResource, type MemberResource, type MemberRow } from "./resources";
import {
  displayNameFromEmail,
  normaliseEmail,
  type InviteMemberBody,
  type UpdateMemberBody,
} from "./tenancy.dto";
import { lastOwner, memberNotFound } from "./tenancy.errors";
import { TenantsService } from "./tenants.service";

@Injectable()
export class MembersService {
  constructor(
    private readonly members: MembersRepository,
    private readonly tenants: TenantsService,
    private readonly database: DatabaseService,
  ) {}

  /**
   * List a tenant's members.
   *
   * @param tenantId - Whose members.
   * @param query - The window the client asked for.
   * @returns One page of members, by name — each with the person's own details, because that
   *   is what a member table renders.
   * @throws {NotFoundError} `404 tenant_not_found` when there is no such tenant.
   */
  async list(tenantId: string, query: PageQuery): Promise<Page<MemberResource>> {
    await this.tenants.require(tenantId);

    const window = windowOf(query);
    const [rows, total] = await Promise.all([
      this.members.list(tenantId, window),
      this.members.count(tenantId),
    ]);

    return pageOf(rows.map(memberResource), total, window);
  }

  /**
   * Invite somebody to a tenant.
   *
   * One transaction for the person and the membership, so an invitation that fails leaves no
   * half-created human behind — a `users` row with no membership is a person Ouroboros has
   * heard of for no reason, and it would hold their address against `users_email_key`.
   *
   * A person who already exists is reused rather than duplicated, and their own display name
   * is left alone: V002 makes `users` global precisely so one human is one row across every
   * tenant, and an inviter typing a name into a form is not authority to rename them in the
   * other tenants they belong to.
   *
   * @param tenantId - The tenant to invite them to.
   * @param body - The validated request.
   * @returns The membership, as the member list shows it.
   * @throws {NotFoundError} `404 tenant_not_found` when there is no such tenant.
   * @throws {ConflictError} `409 member_exists` when they already belong to it — raised by
   *   `tenant_members_pkey`, mapped by `constraints.ts`.
   */
  async invite(tenantId: string, body: InviteMemberBody): Promise<MemberResource> {
    const email = normaliseEmail(body.email);

    return this.database.transaction(async (trx) => {
      await this.tenants.require(tenantId, trx);

      const existing = await this.members.findUserByEmail(email, trx);
      const user =
        existing ??
        (await this.members.createUser(
          email,
          body.displayName ?? displayNameFromEmail(email),
          trx,
        ));

      await this.members.invite(tenantId, user.id, body.role, trx);

      // Read back rather than assembled from what was just written: the resource carries the
      // person's columns *and* the membership's timestamps, and `invited_at` is a default the
      // database chose.
      return memberResource(await this.requireMember(tenantId, user.id, trx));
    });
  }

  /**
   * Change what a member may do.
   *
   * @param tenantId - The tenant.
   * @param userId - The member.
   * @param body - The validated request.
   * @returns The membership after the change.
   * @throws {NotFoundError} `404 tenant_not_found` or `404 member_not_found`.
   * @throws {ConflictError} `409 last_owner` when this would leave the tenant with no owner.
   */
  async changeRole(
    tenantId: string,
    userId: string,
    body: UpdateMemberBody,
  ): Promise<MemberResource> {
    return this.database.transaction(async (trx) => {
      await this.tenants.require(tenantId, trx);
      await this.requireMember(tenantId, userId, trx);

      if (await this.demotionWouldOrphan(tenantId, userId, body.role, trx)) {
        throw lastOwner(userId);
      }

      if (!(await this.members.setRole(tenantId, userId, body.role, trx))) {
        throw memberNotFound(userId);
      }

      return memberResource(await this.requireMember(tenantId, userId, trx));
    });
  }

  /**
   * Remove somebody from a tenant.
   *
   * The person survives; only the membership goes. They may hold roles in other tenants, and
   * a `DELETE` here that removed the human would take those with it.
   *
   * @param tenantId - The tenant.
   * @param userId - The member to remove.
   * @returns When they are no longer a member.
   * @throws {NotFoundError} `404 tenant_not_found` or `404 member_not_found`.
   * @throws {ConflictError} `409 last_owner` when they are the only owner.
   */
  async remove(tenantId: string, userId: string): Promise<void> {
    await this.database.transaction(async (trx) => {
      await this.tenants.require(tenantId, trx);
      await this.requireMember(tenantId, userId, trx);

      // Removal is a demotion to nothing, which is why it asks the same question with no
      // role to move to.
      if (await this.demotionWouldOrphan(tenantId, userId, undefined, trx)) {
        throw lastOwner(userId);
      }

      if (!(await this.members.remove(tenantId, userId, trx))) {
        throw memberNotFound(userId);
      }
    });
  }

  /**
   * Whether taking this person's `owner` role away would leave the tenant with none.
   *
   * The owners are read **with their rows locked**, and the answer is derived from that read
   * rather than from anything read before it — including the membership the caller already
   * fetched. A concurrent transaction that demoted this same person commits before the lock
   * is granted, so by the time this list arrives it is what is true, not what was true.
   *
   * @param tenantId - The tenant.
   * @param userId - The person whose role is being taken away.
   * @param role - What they are becoming, or `undefined` when they are being removed. A
   *   promotion *to* owner asks nothing: it cannot reduce the number of owners.
   * @param trx - The transaction the lock is held for.
   * @returns `true` when this person is the only owner and would stop being one.
   */
  private async demotionWouldOrphan(
    tenantId: string,
    userId: string,
    role: TenantRole | undefined,
    trx: Transaction<Database>,
  ): Promise<boolean> {
    if (role === OWNER) {
      return false;
    }

    const owners = await this.members.ownerIdsForUpdate(tenantId, trx);

    return owners.length === 1 && owners[0] === userId;
  }

  /**
   * The membership, or a `404`.
   *
   * @param tenantId - The tenant.
   * @param userId - The person.
   * @param trx - The transaction to look in.
   * @returns The row, joined to the person.
   * @throws {NotFoundError} `404 member_not_found` when they are not a member.
   */
  private async requireMember(
    tenantId: string,
    userId: string,
    trx: Transaction<Database>,
  ): Promise<MemberRow> {
    const member = await this.members.find(tenantId, userId, trx);

    if (member === undefined) {
      throw memberNotFound(userId);
    }

    return member;
  }
}
