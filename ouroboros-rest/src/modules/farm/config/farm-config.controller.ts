/**
 * `/api/v1/farm/pool-windows` and `/api/v1/farm/job-hooks` — the farm configuration the Build
 * Analyzer composes (BV.5, [#514](https://github.com/NobuData/ouroboros/issues/514)).
 *
 * **Reads are every member's; writes are `@Roles(...ADMINISTRATORS)`** — the POOLS card's split.
 * A window changes which machine builds what and when; a hook runs a command on the workspace's
 * hardware on every matching merge. Both are administering the farm.
 *
 * **The workspace is the session's, never the request's.**
 *
 * A write answers `201` with the resource when it created one and `200` with the existing one when
 * an identical window or hook was already there — so a retry is visible as a retry.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../../auth/principal";
import type { Organization } from "../../db/schema";
import { ADMINISTRATORS, Roles } from "../../tenancy/roles.guard";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import { CreateJobHookBody, CreatePoolWindowBody } from "./farm-config.dto";
import type { JobHookResource, PoolWindowResource } from "./farm-config.resources";
import { JobHooksService } from "./job-hooks.service";
import { PoolWindowsService } from "./pool-windows.service";

/** The one thing these routes set on the response: whether the write created something. */
interface StatusResponse {
  status(code: number): unknown;
}

@Controller("farm")
export class FarmConfigController {
  /**
   * @param windows - Time-windowed pool assignment.
   * @param hooks - Job hooks.
   */
  constructor(
    private readonly windows: PoolWindowsService,
    private readonly hooks: JobHooksService,
  ) {}

  /**
   * `GET /api/v1/farm/pool-windows` — every time-windowed pool assignment.
   *
   * @param tenant - The workspace.
   * @returns The windows, newest first.
   */
  @Get("pool-windows")
  listWindows(@CurrentTenant() tenant: Organization): Promise<PoolWindowResource[]> {
    return this.windows.list(tenant.id);
  }

  /**
   * `POST /api/v1/farm/pool-windows` — a runner joins a pool for a window of the day.
   *
   * @param tenant - The workspace.
   * @param principal - The administrator.
   * @param body - Runner, pool, days, times.
   * @param response - Where the `200`/`201` is set.
   * @returns The window.
   */
  @Post("pool-windows")
  @Roles(...ADMINISTRATORS)
  async addWindow(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: CreatePoolWindowBody,
    @Res({ passthrough: true }) response: StatusResponse,
  ): Promise<PoolWindowResource> {
    const { window, created } = await this.windows.add(tenant.id, principal.user.id, body);
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return window;
  }

  /**
   * `DELETE /api/v1/farm/pool-windows/{id}`.
   *
   * @param tenant - The workspace.
   * @param principal - The administrator.
   * @param id - The window.
   * @returns Nothing, `204`.
   */
  @Delete("pool-windows/:id")
  @Roles(...ADMINISTRATORS)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeWindow(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.windows.remove(tenant.id, principal.user.id, id);
  }

  /**
   * `GET /api/v1/farm/job-hooks` — every job hook.
   *
   * @param tenant - The workspace.
   * @returns The hooks, newest first.
   */
  @Get("job-hooks")
  listHooks(@CurrentTenant() tenant: Organization): Promise<JobHookResource[]> {
    return this.hooks.list(tenant.id);
  }

  /**
   * `POST /api/v1/farm/job-hooks` — register a job the farm submits on every matching merge.
   *
   * @param tenant - The workspace.
   * @param principal - The administrator.
   * @param body - Repository, pool, event, title filter, job.
   * @param response - Where the `200`/`201` is set.
   * @returns The hook.
   */
  @Post("job-hooks")
  @Roles(...ADMINISTRATORS)
  async registerHook(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: CreateJobHookBody,
    @Res({ passthrough: true }) response: StatusResponse,
  ): Promise<JobHookResource> {
    const { hook, created } = await this.hooks.register(tenant.id, principal.user.id, body);
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return hook;
  }

  /**
   * `DELETE /api/v1/farm/job-hooks/{id}`.
   *
   * @param tenant - The workspace.
   * @param principal - The administrator.
   * @param id - The hook.
   * @returns Nothing, `204`.
   */
  @Delete("job-hooks/:id")
  @Roles(...ADMINISTRATORS)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeHook(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.hooks.remove(tenant.id, principal.user.id, id);
  }
}
