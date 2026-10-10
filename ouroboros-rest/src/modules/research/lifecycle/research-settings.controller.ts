/**
 * `/api/v1/research/settings` — who may start an investigation in this workspace (CM.6,
 * [#625](https://github.com/NobuData/ouroboros/issues/625)).
 *
 * Every member reads it, so the composer can say why **New investigation** is inert; owners
 * and admins change it. `member` (the default) lets owners, admins and members start;
 * `admin` lets owners and admins. A viewer never may.
 */

import { Body, Controller, Get, Patch } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../../auth/principal";
import { HumanOnly } from "../../auth/service.scopes";
import type { Organization } from "../../db/schema";
import { ADMINISTRATORS, Roles } from "../../tenancy/roles.guard";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import { PatchResearchSettingsDto } from "./lifecycle.dto";
import type { ResearchSettingsResource } from "./lifecycle.resources";
import { InvestigationLifecycleService } from "./lifecycle.service";

@Controller("research/settings")
export class ResearchSettingsController {
  /** @param lifecycle - The setting's reader and writer. */
  constructor(private readonly lifecycle: InvestigationLifecycleService) {}

  /**
   * `GET …` — the starter role.
   *
   * @param tenant - The workspace.
   * @returns The setting; `member` for a workspace that never chose.
   */
  @Get()
  read(@CurrentTenant() tenant: Organization): Promise<ResearchSettingsResource> {
    return this.lifecycle.settings(tenant.id);
  }

  /**
   * `PATCH …` — change the starter role.
   *
   * @param tenant - The workspace.
   * @param principal - The session, for who changed it.
   * @param patch - The change; a body carrying nothing reads back the current setting.
   * @returns The setting as it now stands.
   */
  @Patch()
  @Roles(...ADMINISTRATORS)
  @HumanOnly()
  update(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() patch: PatchResearchSettingsDto,
  ): Promise<ResearchSettingsResource> {
    return this.lifecycle.updateSettings(tenant.id, principal.user.id, patch);
  }
}
