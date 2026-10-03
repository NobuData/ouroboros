/**
 * `/api/v1/settings/lifecycle` — mockup 17's Danger zone (BR.5,
 * [#489](https://github.com/NobuData/ouroboros/issues/489)).
 *
 * ```
 * GET  /settings/lifecycle                     any member · exempt from the freeze (owner)
 * POST /settings/lifecycle/pause               owner/admin · { confirm: true }
 * POST /settings/lifecycle/resume              owner/admin
 * GET  /settings/lifecycle/disconnect-preview  owner/admin
 * POST /settings/lifecycle/disconnect          owner/admin · { confirm: true }
 * POST /settings/lifecycle/delete              owner · { confirmName, password? } · step-up
 * POST /settings/lifecycle/restore             owner · exempt from the freeze
 * ```
 *
 * The workspace is the session's, never the request's — no `{orgId}` in a path, as on every
 * settings route. Every `POST` answers `200`: each one changes a state, and none creates a thing.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { AuthRequest } from "../auth/http";
import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { ConfirmDto, DeleteWorkspaceDto } from "./lifecycle.dto";
import { LifecycleExempt } from "./lifecycle.freeze.guard";
import type { DisconnectPreviewResource, LifecycleResource } from "./lifecycle.resources";
import { LifecycleService } from "./lifecycle.service";

@Controller("settings/lifecycle")
export class LifecycleController {
  constructor(private readonly lifecycle: LifecycleService) {}

  /**
   * Where the workspace stands, with the banner the shell renders app-wide.
   *
   * @param tenant - The workspace.
   * @returns The lifecycle resource.
   */
  @Get()
  @LifecycleExempt()
  read(@CurrentTenant() tenant: Organization): Promise<LifecycleResource> {
    return this.lifecycle.read(tenant.id);
  }

  /**
   * Pause all loops.
   *
   * @param tenant - The workspace.
   * @param principal - Who asked.
   * @param body - `{ confirm: true }`.
   * @returns The lifecycle afterwards.
   */
  @Post("pause")
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMINISTRATORS)
  pause(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: ConfirmDto,
  ): Promise<LifecycleResource> {
    return this.lifecycle.pause(tenant.id, principal.user.id, body);
  }

  /**
   * Resume all loops.
   *
   * @param tenant - The workspace.
   * @param principal - Who asked.
   * @returns The lifecycle afterwards.
   */
  @Post("resume")
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMINISTRATORS)
  resume(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
  ): Promise<LifecycleResource> {
    return this.lifecycle.resume(tenant.id, principal.user.id);
  }

  /**
   * What disconnecting GitHub would do, computed from live state.
   *
   * @param tenant - The workspace.
   * @returns The preview.
   */
  @Get("disconnect-preview")
  @Roles(...ADMINISTRATORS)
  previewDisconnect(@CurrentTenant() tenant: Organization): Promise<DisconnectPreviewResource> {
    return this.lifecycle.previewDisconnect(tenant.id);
  }

  /**
   * Disconnect GitHub: pause loops, stop syncing, delete the token; open PRs remain.
   *
   * @param tenant - The workspace.
   * @param principal - Who asked.
   * @param body - `{ confirm: true }`.
   * @returns The preview as it stood when the disconnect ran.
   */
  @Post("disconnect")
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMINISTRATORS)
  disconnect(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: ConfirmDto,
  ): Promise<DisconnectPreviewResource> {
    return this.lifecycle.disconnect(tenant.id, principal.user.id, body);
  }

  /**
   * Request deletion — owner, exact name, step-up.
   *
   * @param tenant - The workspace.
   * @param principal - The owner's session.
   * @param request - The raw request, for the step-up's cookie.
   * @param body - `{ confirmName, password? }`.
   * @returns The lifecycle afterwards — `pending_delete`, with `purgeAfter`.
   */
  @Post("delete")
  @HttpCode(HttpStatus.OK)
  @Roles("owner")
  requestDelete(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Req() request: AuthRequest,
    @Body() body: DeleteWorkspaceDto,
  ): Promise<LifecycleResource> {
    return this.lifecycle.requestDelete(tenant.id, principal, request, body);
  }

  /**
   * Restore a workspace pending deletion.
   *
   * @param tenant - The workspace.
   * @param principal - The owner who restores it.
   * @returns The lifecycle afterwards — `active`.
   */
  @Post("restore")
  @HttpCode(HttpStatus.OK)
  @Roles("owner")
  @LifecycleExempt()
  restore(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
  ): Promise<LifecycleResource> {
    return this.lifecycle.restore(tenant.id, principal.user.id);
  }
}
