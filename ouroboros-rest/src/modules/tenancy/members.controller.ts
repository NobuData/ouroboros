/**
 * `/api/v1/tenants/{tenantId}/members` — who belongs to a tenant, and what they may do.
 *
 * The member is addressed by the *user's* id, not by a membership id, because V002 makes
 * `(tenant_id, user_id)` the primary key: the pair is the identity of the row, and there is
 * no surrogate to address it by. `PATCH …/members/{userId}` and `DELETE …/members/{userId}`
 * therefore name a person within a tenant, which is also how mockup 17's member table reads.
 *
 * Two of these four can be refused by a rule no constraint can express — see
 * `members.service.ts` and the `409 last_owner` it raises.
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
  Query,
  UseInterceptors,
} from "@nestjs/common";

import { ConstraintViolationInterceptor } from "./constraints";
import { MembersService } from "./members.service";
import { PageQuery, type Page } from "./pagination";
import { ADMINISTRATORS, Roles } from "./roles.guard";
import type { MemberResource } from "./resources";
import { InviteMemberBody, MemberParams, TenantParams, UpdateMemberBody } from "./tenancy.dto";

@Controller("tenants/:tenantId/members")
@UseInterceptors(ConstraintViolationInterceptor)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  /**
   * `GET …/members` — one page of this tenant's members, by name.
   *
   * @param params - The tenant's id.
   * @param query - `limit` and `offset`.
   * @returns The page, each row carrying the person's own details.
   */
  @Get()
  list(@Param() params: TenantParams, @Query() query: PageQuery): Promise<Page<MemberResource>> {
    return this.members.list(params.tenantId, query);
  }

  /**
   * `POST …/members` — invite somebody.
   *
   * The invitation is a stub: the membership row is created with `joinedAt` null and nothing
   * is sent. What turns it into a joined member is
   * [#33](https://github.com/NobuData/ouroboros/issues/33)'s sign-in.
   *
   * @param params - The tenant's id.
   * @param body - Their address, the role, and a name to use if they are new.
   * @returns The membership, with `201`.
   */
  @Roles(...ADMINISTRATORS)
  @Post()
  invite(@Param() params: TenantParams, @Body() body: InviteMemberBody): Promise<MemberResource> {
    return this.members.invite(params.tenantId, body);
  }

  /**
   * `PATCH …/members/{userId}` — change what they may do.
   *
   * @param params - The tenant's id and the person's.
   * @param body - The new role.
   * @returns The membership after the change.
   */
  @Roles(...ADMINISTRATORS)
  @Patch(":userId")
  changeRole(
    @Param() params: MemberParams,
    @Body() body: UpdateMemberBody,
  ): Promise<MemberResource> {
    return this.members.changeRole(params.tenantId, params.userId, body);
  }

  /**
   * `DELETE …/members/{userId}` — remove them from this tenant.
   *
   * The person is not deleted; only their membership. `204`, and no body.
   *
   * @param params - The tenant's id and the person's.
   * @returns When they are no longer a member.
   */
  @Roles(...ADMINISTRATORS)
  @Delete(":userId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param() params: MemberParams): Promise<void> {
    return this.members.remove(params.tenantId, params.userId);
  }
}
