/**
 * `/api/v1/settings/auto-merge` — mockup 02's one write
 * ([#74](https://github.com/NobuData/ouroboros/issues/74)).
 *
 * **The workspace is the session's, never the request's** — the same sentence the
 * dashboard, runs and queue controllers open with, because it is the same property: no
 * `{orgId}` in the path, the tenant guard resolves and membership-checks the active
 * organization, and these handlers read what it established.
 *
 * **The read is every member's; the write is an administrator's.** The `GET` carries no
 * `@Roles()` on purpose — the roles guard's own rule makes a bare route "any of the four
 * roles", and a viewer is a role that exists to be able to look at the switch it may not
 * flip. The `PATCH` carries `@Roles(...ADMINISTRATORS)`, which is decision F6's whole
 * enforcement: flipping auto-merge changes what the loop does without a human, so it is
 * `owner`/`admin`, refused with the API's one `403` for everybody below.
 *
 * Sessions are required without anything here saying so — the global guard — and a tenant
 * is required *because* nothing here says otherwise: no `@TenantOptional()`, so a session
 * acting in no workspace is a `400 organization_required` before either handler runs.
 */

import { Body, Controller, Get, Patch } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { PatchAutoMergeDto } from "./settings.dto";
import { SettingsService } from "./settings.service";
import type { AutoMergeResource } from "./resources";

@Controller("settings/auto-merge")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /**
   * The switch's position — the stored choice where one exists, `false` where none does.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @returns The resource. Never a 404: the setting always has a value.
   */
  @Get()
  read(@CurrentTenant() tenant: Organization): Promise<AutoMergeResource> {
    return this.settings.read(tenant.id);
  }

  /**
   * Flip the switch; answer with the setting as it now stands.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param patch - The change. Anything but a boolean is a `422` from the validation pipe
   *   naming the field; a body carrying nothing changes nothing and reads back the current
   *   state.
   * @returns The resource after the write — the ticket's *returns the new state*.
   */
  @Patch()
  @Roles(...ADMINISTRATORS)
  update(
    @CurrentTenant() tenant: Organization,
    @Body() patch: PatchAutoMergeDto,
  ): Promise<AutoMergeResource> {
    return this.settings.update(tenant.id, patch);
  }
}
