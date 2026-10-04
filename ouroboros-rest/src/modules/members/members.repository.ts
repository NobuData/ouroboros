/**
 * The statements behind the Members & Roles card
 * ([#485](https://github.com/NobuData/ouroboros/issues/485)) — and nothing else.
 *
 * **Reads only, on the plugin's tables.** `member`, `invitation` and `session` are BetterAuth's,
 * and every write to them goes through the plugin's API (`members.auth.ts`), so its permission
 * checks stay the enforcement. The one table this repository writes is V091's
 * `member_capabilities`, which is this service's own.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";

/** A member as the card needs it. */
export interface MemberRow {
  readonly member_id: string;
  readonly user_id: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
  /** `member.role` as stored — possibly a comma-separated list. */
  readonly role: string;
  readonly joined_at: Date;
  /** The newest `session.updatedAt` of this person, or `null` when they have none. */
  readonly last_active_at: Date | null;
  /** The explicit capability setting, or `null` when the role default applies. */
  readonly can_approve_loops: boolean | null;
}

/** A pending invitation. */
export interface InvitationRow {
  readonly id: string;
  readonly email: string;
  readonly role: string | null;
  readonly status: string;
  readonly created_at: Date;
  readonly expires_at: Date;
  readonly inviter_id: string;
}

/** A service account as the members list shows it (no token, no hint). */
export interface ServiceMemberRow {
  readonly id: string;
  readonly name: string;
  readonly scopes: string[];
  readonly last_used_at: Date | null;
}

@Injectable()
export class MembersRepository {
  /**
   * @param database - The pool owner.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every member of a workspace, owners first by join date.
   *
   * @param organizationId - The workspace.
   * @returns The rows, with last activity and any explicit capability.
   */
  members(organizationId: string): Promise<MemberRow[]> {
    return this.memberQuery(organizationId).orderBy("member.createdAt", "asc").execute();
  }

  /**
   * One member of a workspace.
   *
   * @param organizationId - The workspace.
   * @param memberId - `member.id`.
   * @returns The row, or `undefined` when it is not this workspace's.
   */
  member(organizationId: string, memberId: string): Promise<MemberRow | undefined> {
    return this.memberQuery(organizationId).where("member.id", "=", memberId).executeTakeFirst();
  }

  /**
   * How many members hold the `owner` role — the last-owner rule's count.
   *
   * @param organizationId - The workspace.
   * @returns The count.
   */
  async ownerCount(organizationId: string): Promise<number> {
    const rows = await this.database.db
      .selectFrom("member")
      .select("role")
      .where("organizationId", "=", organizationId)
      .execute();

    // `member.role` may be a list, so the check is per word rather than an equality.
    return rows.filter((row) => row.role.split(",").some((role) => role.trim() === "owner")).length;
  }

  /**
   * The workspace's pending invitations, newest first.
   *
   * @param organizationId - The workspace.
   * @returns The rows.
   */
  invitations(organizationId: string): Promise<InvitationRow[]> {
    return this.invitationQuery(organizationId)
      .where("status", "=", "pending")
      .orderBy("createdAt", "desc")
      .execute();
  }

  /**
   * One invitation of a workspace, in any status.
   *
   * @param organizationId - The workspace.
   * @param id - The invitation.
   * @returns The row, or `undefined` when it is not this workspace's.
   */
  invitation(organizationId: string, id: string): Promise<InvitationRow | undefined> {
    return this.invitationQuery(organizationId).where("id", "=", id).executeTakeFirst();
  }

  /**
   * The newest pending invitation for an email — what an invite just created.
   *
   * @param organizationId - The workspace.
   * @param email - The address, lower-cased as the plugin stores it.
   * @returns The row, or `undefined`.
   */
  pendingInvitationFor(organizationId: string, email: string): Promise<InvitationRow | undefined> {
    return this.invitationQuery(organizationId)
      .where("status", "=", "pending")
      .where("email", "=", email)
      .orderBy("createdAt", "desc")
      .executeTakeFirst();
  }

  /**
   * The workspace's enabled service accounts, for the card's `Service` rows.
   *
   * @param organizationId - The workspace.
   * @returns The rows, by name.
   */
  serviceAccounts(organizationId: string): Promise<ServiceMemberRow[]> {
    return this.database.db
      .selectFrom("service_accounts")
      .leftJoin("service_tokens", (join) =>
        join
          .onRef("service_tokens.service_account_id", "=", "service_accounts.id")
          .on("service_tokens.revoked_at", "is", null),
      )
      .select([
        "service_accounts.id",
        "service_accounts.name",
        "service_accounts.scopes",
        "service_tokens.last_used_at",
      ])
      .where("service_accounts.organization_id", "=", organizationId)
      .where("service_accounts.disabled_at", "is", null)
      .orderBy("service_accounts.name", "asc")
      .execute();
  }

  /**
   * Store an explicit capability setting, replacing any earlier one.
   *
   * @param organizationId - The workspace.
   * @param memberId - The member.
   * @param canApproveLoops - The setting.
   * @param actorId - Who set it.
   * @param at - When.
   */
  async setCanApproveLoops(
    organizationId: string,
    memberId: string,
    canApproveLoops: boolean,
    actorId: string,
    at: Date,
  ): Promise<void> {
    await this.database.db
      .insertInto("member_capabilities")
      .values({
        member_id: memberId,
        organization_id: organizationId,
        can_approve_loops: canApproveLoops,
        updated_by: actorId,
        updated_at: at,
      })
      .onConflict((conflict) =>
        conflict.column("member_id").doUpdateSet({
          can_approve_loops: canApproveLoops,
          updated_by: actorId,
          updated_at: at,
        }),
      )
      .execute();
  }

  /**
   * The member read {@link members} and {@link member} share.
   *
   * @param organizationId - The workspace.
   * @returns The query.
   */
  private memberQuery(organizationId: string) {
    return this.database.db
      .selectFrom("member")
      .innerJoin("user", "user.id", "member.userId")
      .leftJoin("member_capabilities", "member_capabilities.member_id", "member.id")
      .select([
        "member.id as member_id",
        "user.id as user_id",
        "user.name",
        "user.email",
        "user.image",
        "member.role",
        "member.createdAt as joined_at",
        "member_capabilities.can_approve_loops",
        // Sessions are per person, not per workspace, so this is when they were last active
        // anywhere in the product — the signal the session table actually holds.
        (eb) =>
          eb
            .selectFrom("session")
            .select((inner) => inner.fn.max<Date | null>("session.updatedAt").as("at"))
            .whereRef("session.userId", "=", "user.id")
            .as("last_active_at"),
      ])
      .where("member.organizationId", "=", organizationId);
  }

  /**
   * The invitation read the invitation methods share.
   *
   * @param organizationId - The workspace.
   * @returns The query.
   */
  private invitationQuery(organizationId: string) {
    return this.database.db
      .selectFrom("invitation")
      .select([
        "id",
        "email",
        "role",
        "status",
        "createdAt as created_at",
        "expiresAt as expires_at",
        "inviterId as inviter_id",
      ])
      .where("organizationId", "=", organizationId);
  }
}
