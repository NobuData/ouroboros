/**
 * `/api/v1/settings/retention` — the workspace card's *Data retention* select and its advanced
 * per-class editor (BQ.3, [#482](https://github.com/NobuData/ouroboros/issues/482)).
 *
 * The workspace is the session's, never the request's, as in `settings/workspace.controller.ts`.
 * **The read is every member's; the write is an administrator's**: the `GET` answers a viewer with
 * `editable: false, reason: "role"`, and the `PATCH` carries `@Roles(...ADMINISTRATORS)`, because
 * how long a workspace's data is kept is an `owner`/`admin` decision.
 */

import { Body, Controller, Get, Patch } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import { HumanOnly } from "../auth/service.scopes";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import type { ActiveMembership } from "../tenancy/tenant.context";
import { CurrentMember } from "../tenancy/tenant.decorators";
import { PatchRetentionDto } from "./retention.dto";
import type { RetentionSettingsResource } from "./retention.resources";
import { RetentionPolicyService } from "./retention.service";

@Controller("settings/retention")
export class RetentionController {
  constructor(private readonly retention: RetentionPolicyService) {}

  /**
   * The card — every class's tier, its bounds, and when its next sweep applies a change.
   *
   * @param member - The membership the tenant guard established: the workspace and the roles.
   * @param principal - The session, for the caller's id.
   * @returns The card. Never a 404: every workspace has a tier for every core class.
   */
  @Get()
  // The caller's own view (`editable` is theirs), so a service account has nobody to read it for.
  @HumanOnly()
  read(
    @CurrentMember() member: ActiveMembership,
    @Session() principal: Principal,
  ): Promise<RetentionSettingsResource> {
    return this.retention.read(member.tenant.id, {
      userId: principal.user.id,
      roles: member.roles,
    });
  }

  /**
   * Save the simple select (`loopDays`) or the advanced editor (`classes`); answer with the card.
   *
   * @param member - The membership the tenant guard established.
   * @param principal - The session — the audit actor.
   * @param patch - The change. A tier outside its class's bounds is `422 retention_out_of_bounds`
   *   with `details.refusals` and `details.fields`; a malformed body is `422 validation_failed`.
   *   A body carrying nothing reads back the current card.
   * @returns The card after the save.
   */
  @Patch()
  @Roles(...ADMINISTRATORS)
  update(
    @CurrentMember() member: ActiveMembership,
    @Session() principal: Principal,
    @Body() patch: PatchRetentionDto,
  ): Promise<RetentionSettingsResource> {
    return this.retention.update(
      member.tenant.id,
      { userId: principal.user.id, roles: member.roles },
      patch,
    );
  }
}
