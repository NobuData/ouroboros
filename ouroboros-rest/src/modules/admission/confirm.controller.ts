/**
 * The member routes of live-run admission (DI.4,
 * [#1312](https://github.com/NobuData/ouroboros/issues/1312)).
 *
 * ```
 * POST  /api/v1/queue/{id}/confirm        contributors holding can_approve_loops · people only
 * GET   /api/v1/settings/live-execution   any member
 * PATCH /api/v1/settings/live-execution   owner · admin · people only
 * ```
 *
 * **Confirming is the start of a live run** (decision L5): a run is started only by a signed-in
 * person with the approval capability, so the route refuses service accounts and members
 * without `can_approve_loops` — `403 capability_required` — before anything is read.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import { HumanOnly } from "../auth/service.scopes";
import type { QueueItemSummary } from "../dashboard/resources";
import type { Organization } from "../db/schema";
import { RequiresCapability } from "../tenancy/capabilities";
import { ADMINISTRATORS, CONTRIBUTORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { PatchLiveExecutionDto, QueueItemIdParams } from "./admission.dto";
import { ConfirmService, type LiveExecutionSettingsResource } from "./confirm.service";

@Controller("queue")
export class ConfirmController {
  /** @param confirmations - The action. */
  constructor(private readonly confirmations: ConfirmService) {}

  /**
   * **Confirm for live run** — make a queued issue claimable by the engine.
   *
   * @param tenant - The workspace.
   * @param principal - The session, for who confirmed.
   * @param params - The queue item.
   * @returns The item, with whatever else still holds it.
   */
  @Post(":id/confirm")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  @RequiresCapability("can_approve_loops")
  @HumanOnly()
  confirm(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: QueueItemIdParams,
  ): Promise<QueueItemSummary> {
    return this.confirmations.confirm(tenant.id, params.id, principal.user.id);
  }
}

@Controller("settings/live-execution")
export class LiveExecutionSettingsController {
  /** @param confirmations - The settings' reader and writer. */
  constructor(private readonly confirmations: ConfirmService) {}

  /**
   * The workspace's live-run ceiling, beside the deployment's switch and limits.
   *
   * @param tenant - The workspace.
   * @returns The settings.
   */
  @Get()
  read(@CurrentTenant() tenant: Organization): Promise<LiveExecutionSettingsResource> {
    return this.confirmations.settings(tenant.id);
  }

  /**
   * Set how many live runs may execute at once in the workspace.
   *
   * @param tenant - The workspace.
   * @param principal - The session, for who changed it.
   * @param patch - The new ceiling.
   * @returns The settings as they now stand.
   */
  @Patch()
  @Roles(...ADMINISTRATORS)
  @HumanOnly()
  update(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() patch: PatchLiveExecutionDto,
  ): Promise<LiveExecutionSettingsResource> {
    return this.confirmations.setCeiling(tenant.id, patch.ceiling, principal.user.id);
  }
}
