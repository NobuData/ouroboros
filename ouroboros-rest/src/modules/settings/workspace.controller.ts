/**
 * `/api/v1/settings/workspace` — the Settings page's workspace card
 * ([#483](https://github.com/NobuData/ouroboros/issues/483)).
 *
 * **The workspace is the session's, never the request's**, as in `settings.controller.ts`: no
 * `{orgId}` in the path; the tenant guard resolves and membership-checks the active organization.
 *
 * **The read is every member's; the write is an administrator's.** The `GET` carries no
 * `@Roles()`, so a viewer sees the card — with `editable: false, reason: "role"` on the fields
 * they may not change, rather than inputs that fail on save. The `PATCH` carries
 * `@Roles(...ADMINISTRATORS)`: renaming a workspace or changing how sign-in finds it is an
 * `owner`/`admin` decision, refused with the API's one `403` for everybody below.
 *
 * **Constraint violations answer as the tenancy routes' do.** Two administrators saving domains at
 * once can trip `tenant_domains_one_primary_per_organization`; the tenancy interceptor turns that
 * into `409 conflict` ("try again") rather than a `500`.
 */

import { Body, Controller, Get, Patch, UseInterceptors } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import { ConstraintViolationInterceptor } from "../tenancy/constraints";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import type { ActiveMembership } from "../tenancy/tenant.context";
import { CurrentMember } from "../tenancy/tenant.decorators";
import { PatchWorkspaceDto } from "./workspace.dto";
import type { WorkspaceSettingsResource } from "./workspace.resources";
import { WorkspaceService } from "./workspace.service";

@Controller("settings/workspace")
@UseInterceptors(ConstraintViolationInterceptor)
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  /**
   * The card — name, domain, region and training data, each with its affordance.
   *
   * @param member - The membership the tenant guard established: the workspace and the roles.
   * @param principal - The session, for the caller's id.
   * @returns The card. Never a 404: a workspace always has a card.
   */
  @Get()
  read(
    @CurrentMember() member: ActiveMembership,
    @Session() principal: Principal,
  ): Promise<WorkspaceSettingsResource> {
    return this.workspace.read(member.tenant.id, {
      userId: principal.user.id,
      roles: member.roles,
    });
  }

  /**
   * Save the name and/or the tenant domain; answer with the card as it now stands.
   *
   * @param member - The membership the tenant guard established.
   * @param principal - The session — the audit actor.
   * @param patch - The change. A refused field is a `422 validation_failed` naming it in
   *   `details.fields`; a domain another workspace holds is `409 domain_taken`, also with
   *   `details.fields.domain`. A body carrying nothing reads back the current card.
   * @returns The card after the save.
   */
  @Patch()
  @Roles(...ADMINISTRATORS)
  update(
    @CurrentMember() member: ActiveMembership,
    @Session() principal: Principal,
    @Body() patch: PatchWorkspaceDto,
  ): Promise<WorkspaceSettingsResource> {
    return this.workspace.update(
      member.tenant.id,
      { userId: principal.user.id, roles: member.roles },
      patch,
    );
  }
}
