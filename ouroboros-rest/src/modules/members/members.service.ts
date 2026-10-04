/**
 * The Members & Roles card's rules ([#485](https://github.com/NobuData/ouroboros/issues/485), BR.1).
 *
 * ```
 * page     members (S3 display roles, capability, last active) + pending invitations
 *          + service accounts + footer
 * invite   → plugin createInvitation                     member.invited
 * resend   → plugin createInvitation{resend}             member.invitation_resent
 * revoke   → plugin cancelInvitation                     member.invitation_revoked
 * update   role → last-owner rule → plugin updateMemberRole   member.role_changed (before/after)
 *          canApproveLoops → member_capabilities          member.capability_changed
 * remove   last-owner rule → plugin removeMember          member.removed
 * ```
 *
 * **The last-owner rule is checked here, and refused attempts are audited.** The plugin has its
 * own guards, but its answer is a library message; the card needs a clear reason, and an attempt
 * to strip a workspace of its last owner is exactly the kind of thing an audit trail is for.
 *
 * **A role change does not touch the capability.** A member whose `can_approve_loops` was set
 * explicitly keeps that setting through any role change; a member who was never set keeps
 * following their role's default. That is the whole of "defaults follow role but survive
 * independent edits".
 */

import { Inject, Injectable } from "@nestjs/common";

import {
  MEMBER_CAPABILITY_CHANGED_EVENT,
  MEMBER_INVITATION_RESENT_EVENT,
  MEMBER_INVITATION_REVOKED_EVENT,
  MEMBER_INVITED_EVENT,
  MEMBER_REMOVED_EVENT,
  MEMBER_ROLE_CHANGED_EVENT,
  type AuditAction,
  type AuditDetail,
} from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import type { AuditSubjectType } from "../audit/audit.events";
import type { OrganizationRole } from "../db/schema";
import { ADMINISTRATORS } from "../tenancy/roles.guard";
import { effectiveCanApproveLoops } from "../tenancy/capabilities";
import { rolesFrom } from "../tenancy/organization.repository";
import { MEMBER_DIRECTORY, type MemberDirectory } from "./members.auth";
import type { InviteMemberDto, UpdateMemberDto } from "./members.dto";
import {
  invitationNotFound,
  invitationNotPending,
  MEMBERS_ERRORS,
  memberUpdateEmpty,
  ownerProtected,
  workspaceMemberNotFound,
} from "./members.errors";
import { MembersRepository, type InvitationRow, type MemberRow } from "./members.repository";
import {
  invitationResource,
  memberResource,
  serviceMemberResource,
  type InvitationResource,
  type MemberResource,
  type MembersPageResource,
} from "./members.resources";
import { displayRoleOf, roleHierarchyLine } from "./members.roles";
import { DirectorySyncStatus } from "./members.sync";

/** Who is asking, and with which cookies — what every write hands the plugin. */
export interface MembersCaller {
  /** The caller's user id. */
  readonly userId: string;
  /** The caller's roles in the workspace. */
  readonly roles: readonly OrganizationRole[];
  /** The caller's cookies, so the plugin checks *their* permission. */
  readonly headers: Headers;
}

@Injectable()
export class MembersService {
  /**
   * @param members - The reads, and the capability write.
   * @param directory - The plugin's writes.
   * @param audit - AD.4's trail.
   * @param sync - The footer's directory-sync line (absent until BT.1).
   */
  constructor(
    private readonly members: MembersRepository,
    @Inject(MEMBER_DIRECTORY) private readonly directory: MemberDirectory,
    private readonly audit: AuditService,
    private readonly sync: DirectorySyncStatus,
  ) {}

  /**
   * The card.
   *
   * @param organizationId - The workspace.
   * @param caller - Who is asking, for `you` and `canManage`.
   * @returns Members, pending invitations, service accounts and the footer.
   */
  async page(
    organizationId: string,
    caller: Pick<MembersCaller, "userId" | "roles">,
  ): Promise<MembersPageResource> {
    const now = new Date();
    const [members, invitations, services, directorySync] = await Promise.all([
      this.members.members(organizationId),
      this.members.invitations(organizationId),
      this.members.serviceAccounts(organizationId),
      this.sync.current(organizationId),
    ]);

    return {
      members: members.map((row) => memberResource(row, caller.userId)),
      invitations: invitations.map((row) => invitationResource(row, now)),
      serviceAccounts: services.map(serviceMemberResource),
      canManage: caller.roles.some((role) => ADMINISTRATORS.includes(role)),
      footer: { hierarchy: roleHierarchyLine(), directorySync },
    };
  }

  /**
   * Invite somebody, through the plugin.
   *
   * @param organizationId - The workspace.
   * @param caller - Who is inviting.
   * @param request - The address and role.
   * @returns The pending invitation, with its real `invitedAt`.
   */
  async invite(
    organizationId: string,
    caller: MembersCaller,
    request: InviteMemberDto,
  ): Promise<InvitationResource> {
    await this.directory.invite(caller.headers, {
      organizationId,
      email: request.email,
      role: request.role,
      resend: false,
    });

    const row = await this.members.pendingInvitationFor(
      organizationId,
      request.email.toLowerCase(),
    );

    if (row === undefined) throw invitationNotFound(request.email);

    await this.record(organizationId, caller.userId, MEMBER_INVITED_EVENT, "invitation", row.id, {
      role: request.role,
    });

    return invitationResource(row, new Date());
  }

  /**
   * Refresh a pending invitation's expiry, through the plugin. `invitedAt` does not move.
   *
   * @param organizationId - The workspace.
   * @param caller - Who is resending.
   * @param invitationId - The invitation.
   * @returns The invitation with its new expiry.
   * @throws {NotFoundError} `invitation_not_found`.
   * @throws {ConflictError} `invitation_not_pending`.
   */
  async resend(
    organizationId: string,
    caller: MembersCaller,
    invitationId: string,
  ): Promise<InvitationResource> {
    const row = await this.pending(organizationId, invitationId);

    await this.directory.invite(caller.headers, {
      organizationId,
      email: row.email,
      role: rolesFrom(row.role ?? "member")[0] ?? "member",
      resend: true,
    });

    const refreshed = (await this.members.invitation(organizationId, invitationId)) ?? row;

    await this.record(
      organizationId,
      caller.userId,
      MEMBER_INVITATION_RESENT_EVENT,
      "invitation",
      invitationId,
      { expires_at: refreshed.expires_at.toISOString() },
    );

    return invitationResource(refreshed, new Date());
  }

  /**
   * Revoke a pending invitation, through the plugin.
   *
   * @param organizationId - The workspace.
   * @param caller - Who is revoking.
   * @param invitationId - The invitation.
   * @throws {NotFoundError} `invitation_not_found`.
   * @throws {ConflictError} `invitation_not_pending`.
   */
  async revoke(organizationId: string, caller: MembersCaller, invitationId: string): Promise<void> {
    await this.pending(organizationId, invitationId);
    await this.directory.cancelInvitation(caller.headers, invitationId);
    await this.record(
      organizationId,
      caller.userId,
      MEMBER_INVITATION_REVOKED_EVENT,
      "invitation",
      invitationId,
      {},
    );
  }

  /**
   * Change a member's role, their capability, or both.
   *
   * @param organizationId - The workspace.
   * @param caller - Who is changing it.
   * @param memberId - The member.
   * @param request - The new role and/or capability.
   * @returns The member afterwards.
   * @throws {InvalidRequestError} `member_update_empty`.
   * @throws {NotFoundError} `workspace_member_not_found`.
   * @throws {ConflictError} `owner_protected` — the last owner cannot be demoted (audited).
   */
  async update(
    organizationId: string,
    caller: MembersCaller,
    memberId: string,
    request: UpdateMemberDto,
  ): Promise<MemberResource> {
    if (request.role === undefined && request.canApproveLoops === undefined) {
      throw memberUpdateEmpty();
    }

    const member = await this.found(organizationId, memberId);
    const before = rolesFrom(member.role);

    if (request.role !== undefined && !(before.length === 1 && before[0] === request.role)) {
      await this.changeRole(organizationId, caller, member, before, request.role);
    }

    if (request.canApproveLoops !== undefined) {
      await this.setCapability(organizationId, caller.userId, member, request.canApproveLoops);
    }

    return memberResource(await this.found(organizationId, memberId), caller.userId);
  }

  /**
   * Remove a member, through the plugin.
   *
   * @param organizationId - The workspace.
   * @param caller - Who is removing them.
   * @param memberId - The member.
   * @throws {NotFoundError} `workspace_member_not_found`.
   * @throws {ConflictError} `owner_protected` — the last owner cannot be removed (audited).
   */
  async remove(organizationId: string, caller: MembersCaller, memberId: string): Promise<void> {
    const member = await this.found(organizationId, memberId);
    const roles = rolesFrom(member.role);

    if (await this.isLastOwner(organizationId, roles)) {
      await this.record(organizationId, caller.userId, MEMBER_REMOVED_EVENT, "member", memberId, {
        outcome: "failure",
        reason: MEMBERS_ERRORS.ownerProtected,
        before: roles.join(","),
      });
      throw ownerProtected(memberId, "remove");
    }

    await this.directory.remove(caller.headers, { organizationId, memberId });
    await this.record(organizationId, caller.userId, MEMBER_REMOVED_EVENT, "member", memberId, {
      outcome: "success",
      before: roles.join(","),
      before_display: displayRoleOf(roles),
    });
  }

  /**
   * The role half of {@link update}: the last-owner rule, the plugin call, the audit.
   *
   * @param organizationId - The workspace.
   * @param caller - Who is changing it.
   * @param member - The member.
   * @param before - Their roles now.
   * @param after - The role asked for.
   */
  private async changeRole(
    organizationId: string,
    caller: MembersCaller,
    member: MemberRow,
    before: OrganizationRole[],
    after: OrganizationRole,
  ): Promise<void> {
    const detail = {
      before: before.join(","),
      after,
      before_display: displayRoleOf(before),
      after_display: displayRoleOf([after]),
    };

    if (after !== "owner" && (await this.isLastOwner(organizationId, before))) {
      await this.record(
        organizationId,
        caller.userId,
        MEMBER_ROLE_CHANGED_EVENT,
        "member",
        member.member_id,
        {
          ...detail,
          outcome: "failure",
          reason: MEMBERS_ERRORS.ownerProtected,
        },
      );
      throw ownerProtected(member.member_id, "demote");
    }

    await this.directory.updateRole(caller.headers, {
      organizationId,
      memberId: member.member_id,
      role: after,
    });
    await this.record(
      organizationId,
      caller.userId,
      MEMBER_ROLE_CHANGED_EVENT,
      "member",
      member.member_id,
      {
        ...detail,
        outcome: "success",
      },
    );
  }

  /**
   * The capability half of {@link update}: store the explicit setting and audit before/after.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who set it.
   * @param member - The member, as read before the update.
   * @param value - The new setting.
   */
  private async setCapability(
    organizationId: string,
    actorId: string,
    member: MemberRow,
    value: boolean,
  ): Promise<void> {
    // Re-read: a role change in the same request may have moved the default.
    const current = await this.found(organizationId, member.member_id);
    const before = effectiveCanApproveLoops(rolesFrom(current.role), current.can_approve_loops);

    await this.members.setCanApproveLoops(
      organizationId,
      member.member_id,
      value,
      actorId,
      new Date(),
    );
    await this.record(
      organizationId,
      actorId,
      MEMBER_CAPABILITY_CHANGED_EVENT,
      "member",
      member.member_id,
      {
        capability: "can_approve_loops",
        before,
        after: value,
        before_source: current.can_approve_loops === null ? "role" : "explicit",
      },
    );
  }

  /**
   * Whether a member holding `roles` is the workspace's only owner.
   *
   * @param organizationId - The workspace.
   * @param roles - The member's roles.
   * @returns `true` when they hold `owner` and nobody else does.
   */
  private async isLastOwner(
    organizationId: string,
    roles: readonly OrganizationRole[],
  ): Promise<boolean> {
    return roles.includes("owner") && (await this.members.ownerCount(organizationId)) <= 1;
  }

  /**
   * Read a pending invitation, or refuse.
   *
   * @param organizationId - The workspace.
   * @param invitationId - The invitation.
   * @returns The row.
   */
  private async pending(organizationId: string, invitationId: string): Promise<InvitationRow> {
    const row = await this.members.invitation(organizationId, invitationId);

    if (row === undefined) throw invitationNotFound(invitationId);
    if (row.status !== "pending") throw invitationNotPending(invitationId, row.status);

    return row;
  }

  /**
   * Read a member, or refuse.
   *
   * @param organizationId - The workspace.
   * @param memberId - The member.
   * @returns The row.
   */
  private async found(organizationId: string, memberId: string): Promise<MemberRow> {
    const row = await this.members.member(organizationId, memberId);

    if (row === undefined) throw workspaceMemberNotFound(memberId);

    return row;
  }

  /**
   * Write one event. Never an email address: the trail names people, not mailboxes.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who.
   * @param action - What.
   * @param subjectType - `member` or `invitation`.
   * @param subjectId - Which.
   * @param detail - The flat detail.
   */
  private async record(
    organizationId: string,
    actorId: string,
    action: AuditAction,
    subjectType: AuditSubjectType,
    subjectId: string,
    detail: AuditDetail,
  ): Promise<void> {
    await this.audit.record({
      organizationId,
      actorId,
      action,
      subjectType,
      subjectId,
      at: new Date(),
      detail,
    });
  }
}
