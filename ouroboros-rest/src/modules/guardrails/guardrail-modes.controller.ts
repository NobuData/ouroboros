/**
 * The guardrail-mode settings routes (AR.1, [#315](https://github.com/NobuData/ouroboros/issues/315),
 * decision 1). API only — there is no settings screen.
 *
 * ```
 * GET   /api/v1/settings/guardrails   any member
 * PATCH /api/v1/settings/guardrails   owner · admin · people only
 * ```
 *
 * Who may read and write matches the live-execution settings (#1312): reading is a question any
 * member may ask, and loosening what stops a run is an administrator's decision, made in person.
 */

import { Body, Controller, Get, Patch } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import { HumanOnly } from "../auth/service.scopes";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { PatchGuardrailModesDto } from "./guardrail-modes.dto";
import { GuardrailModesService, type GuardrailModesResource } from "./guardrail-modes.service";

@Controller("settings/guardrails")
export class GuardrailModesController {
  /** @param modes - The settings' reader and writer. */
  constructor(private readonly modes: GuardrailModesService) {}

  /**
   * Whether each guardrail check stops a run (`block`) or is only shown (`warn`).
   *
   * @param tenant - The workspace.
   * @returns All four checks' modes.
   */
  @Get()
  read(@CurrentTenant() tenant: Organization): Promise<GuardrailModesResource> {
    return this.modes.read(tenant.id);
  }

  /**
   * Change some checks' modes.
   *
   * @param tenant - The workspace.
   * @param principal - The session, for who changed them.
   * @param patch - The checks to change.
   * @returns All four checks' modes as they now stand.
   */
  @Patch()
  @Roles(...ADMINISTRATORS)
  @HumanOnly()
  update(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() patch: PatchGuardrailModesDto,
  ): Promise<GuardrailModesResource> {
    return this.modes.update(tenant.id, { ...patch.modes }, principal.user.id);
  }
}
