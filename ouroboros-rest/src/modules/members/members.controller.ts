/**
 * `/api/v1/settings/members` — the Members & Roles card
 * ([#485](https://github.com/NobuData/ouroboros/issues/485), BR.1).
 *
 * **Reading is every member's; changing is an administrator's.** The list carries `@Roles()` on
 * nothing, so a viewer sees the card; every write is `@Roles(...ADMINISTRATORS)` here *and* goes
 * through the organization plugin with the caller's cookies, so the plugin's own permission check
 * runs too (an admin cannot make someone an owner, for instance — that is the plugin's rule).
 *
 * **People only.** The list is `@HumanOnly()` because it answers *which row is you*; the writes
 * are administrator-gated, which no service account can reach (`auth/service.scopes.ts`).
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import { cookieHeaders, type AuthRequest } from "../auth/http";
import type { Principal } from "../auth/principal";
import { HumanOnly } from "../auth/service.scopes";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import type { ActiveMembership } from "../tenancy/tenant.context";
import { CurrentMember } from "../tenancy/tenant.decorators";
import { InviteMemberDto, UpdateMemberDto } from "./members.dto";
import type { InvitationResource, MemberResource, MembersPageResource } from "./members.resources";
import { MembersService, type MembersCaller } from "./members.service";

@Controller("settings/members")
export class MembersController {
  /**
   * @param members - The card's rules.
   */
  constructor(private readonly members: MembersService) {}

  /**
   * The card: members, pending invitations, service accounts and the footer.
   *
   * @param member - The caller's membership.
   * @param principal - The caller, for `you`.
   * @returns The page.
   */
  @Get()
  @HumanOnly()
  page(
    @CurrentMember() member: ActiveMembership,
    @Session() principal: Principal,
  ): Promise<MembersPageResource> {
    return this.members.page(member.tenant.id, { userId: principal.user.id, roles: member.roles });
  }

  /**
   * Invite somebody.
   *
   * @param member - The caller's membership.
   * @param principal - The caller.
   * @param request - Their cookies, for the plugin.
   * @param body - The address and role.
   * @returns The pending invitation, `201`.
   */
  @Post("invitations")
  @Roles(...ADMINISTRATORS)
  invite(
    @CurrentMember() member: ActiveMembership,
    @Session() principal: Principal,
    @Req() request: AuthRequest,
    @Body() body: InviteMemberDto,
  ): Promise<InvitationResource> {
    return this.members.invite(member.tenant.id, caller(member, principal, request), body);
  }

  /**
   * Resend a pending invitation — its expiry is refreshed; `invitedAt` stays.
   *
   * @param member - The caller's membership.
   * @param principal - The caller.
   * @param request - Their cookies.
   * @param id - The invitation.
   * @returns The invitation.
   */
  @Post("invitations/:id/resend")
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMINISTRATORS)
  resend(
    @CurrentMember() member: ActiveMembership,
    @Session() principal: Principal,
    @Req() request: AuthRequest,
    @Param("id") id: string,
  ): Promise<InvitationResource> {
    return this.members.resend(member.tenant.id, caller(member, principal, request), id);
  }

  /**
   * Revoke a pending invitation.
   *
   * @param member - The caller's membership.
   * @param principal - The caller.
   * @param request - Their cookies.
   * @param id - The invitation.
   */
  @Delete("invitations/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...ADMINISTRATORS)
  revoke(
    @CurrentMember() member: ActiveMembership,
    @Session() principal: Principal,
    @Req() request: AuthRequest,
    @Param("id") id: string,
  ): Promise<void> {
    return this.members.revoke(member.tenant.id, caller(member, principal, request), id);
  }

  /**
   * Change a member's role and/or `can_approve_loops`.
   *
   * @param member - The caller's membership.
   * @param principal - The caller.
   * @param request - Their cookies.
   * @param memberId - The member.
   * @param body - The change.
   * @returns The member afterwards.
   */
  @Patch(":memberId")
  @Roles(...ADMINISTRATORS)
  update(
    @CurrentMember() member: ActiveMembership,
    @Session() principal: Principal,
    @Req() request: AuthRequest,
    @Param("memberId") memberId: string,
    @Body() body: UpdateMemberDto,
  ): Promise<MemberResource> {
    return this.members.update(
      member.tenant.id,
      caller(member, principal, request),
      memberId,
      body,
    );
  }

  /**
   * Remove a member.
   *
   * @param member - The caller's membership.
   * @param principal - The caller.
   * @param request - Their cookies.
   * @param memberId - The member.
   */
  @Delete(":memberId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...ADMINISTRATORS)
  remove(
    @CurrentMember() member: ActiveMembership,
    @Session() principal: Principal,
    @Req() request: AuthRequest,
    @Param("memberId") memberId: string,
  ): Promise<void> {
    return this.members.remove(member.tenant.id, caller(member, principal, request), memberId);
  }
}

/**
 * Who is asking, as the service needs it.
 *
 * @param member - The membership.
 * @param principal - The session.
 * @param request - The request, for its cookies.
 * @returns The caller.
 */
function caller(
  member: ActiveMembership,
  principal: Principal,
  request: AuthRequest,
): MembersCaller {
  return { userId: principal.user.id, roles: member.roles, headers: cookieHeaders(request) };
}
