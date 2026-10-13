/**
 * The on-call designee's routes (CA.3, [#543](https://github.com/NobuData/ouroboros/issues/543))
 * — what the Chat Ops page's routing card reads beside *+ DM on-call*, and its picker writes.
 *
 * ```
 * GET  /api/v1/chat/on-call   any member    who is on call · who could be
 * PUT  /api/v1/chat/on-call   owner/admin   { memberId | null } — put a member on call, or nobody
 * ```
 *
 * **Every member reads; administrators write** — who is DMed when a loop is blocked is decided
 * for the workspace, as its channel bindings are (`slack.channels.controller.ts`). The write
 * answers with the resource as it now stands.
 *
 * The routes are under `/chat` because the designee is a chat matter, whatever the platform; they
 * live in this module because who can be reached is a Slack identity link, which it owns.
 */

import { Body, Controller, Get, Put } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { PutOnCallDto } from "./slack.on-call.dto";
import { type OnCallResource, SlackOnCallService } from "./slack.on-call.service";

@Controller("chat/on-call")
export class SlackOnCallController {
  /** @param onCall - The operations. */
  constructor(private readonly onCall: SlackOnCallService) {}

  /**
   * `GET /chat/on-call` — who is on call for decisions, and who could be.
   *
   * @param tenant - The workspace.
   * @returns The designee, or none, and the members with a linked Slack identity.
   */
  @Get()
  read(@CurrentTenant() tenant: Organization): Promise<OnCallResource> {
    return this.onCall.read(tenant.id);
  }

  /**
   * `PUT /chat/on-call` — put a member on call, or nobody.
   *
   * @param tenant - The workspace.
   * @param principal - Who chose — the audit actor, and the assignment's `assigned_by`.
   * @param body - The member, or `null`.
   * @returns Who is on call after it.
   * @throws {NotFoundError} `404 chat_member_not_found`.
   * @throws {InvalidRequestError} `422 chat_on_call_not_linked`.
   */
  @Put()
  @Roles(...ADMINISTRATORS)
  assign(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: PutOnCallDto,
  ): Promise<OnCallResource> {
    return this.onCall.assign(tenant.id, principal.user.id, body.memberId);
  }
}
