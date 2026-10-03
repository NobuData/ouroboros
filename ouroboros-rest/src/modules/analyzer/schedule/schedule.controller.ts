/**
 * `/api/v1/analyzer/schedule` — a repository's Build Analyzer schedule: the weekly slot, the
 * every-N-builds threshold with its live counter, and the budgets every run is held to (BW.1,
 * [#516](https://github.com/NobuData/ouroboros/issues/516), mockup 18's
 * **Schedule: weekly + every 50 builds ▾**).
 *
 * **Who may do what.** Reading is every member's, a viewer included. Saving changes when the
 * workspace's build data is read and how much compute it spends, so it is an administrator's
 * (`owner`/`admin`), audited.
 *
 * **The workspace is the session's, never the request's**; a repository it does not have is a
 * `404`.
 */

import { Body, Controller, Get, Put, Query } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../../auth/principal";
import type { Organization } from "../../db/schema";
import { ADMINISTRATORS, Roles } from "../../tenancy/roles.guard";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import { AnalysisScheduleQuery, PutAnalysisScheduleBody } from "./schedule.dto";
import type { AnalysisScheduleResource } from "./schedule.resources";
import { AnalysisScheduleService } from "./schedule.service";

@Controller("analyzer/schedule")
export class AnalysisScheduleController {
  /** @param schedules - The request side. */
  constructor(private readonly schedules: AnalysisScheduleService) {}

  /**
   * `GET /api/v1/analyzer/schedule?repo=` — a repository's schedule.
   *
   * @param tenant - The workspace.
   * @param query - `{repo}`.
   * @returns The schedule, or V080's defaults with `saved: false`.
   */
  @Get()
  read(
    @CurrentTenant() tenant: Organization,
    @Query() query: AnalysisScheduleQuery,
  ): Promise<AnalysisScheduleResource> {
    return this.schedules.read(tenant.id, query.repo);
  }

  /**
   * `PUT /api/v1/analyzer/schedule` — save a repository's whole schedule.
   *
   * @param tenant - The workspace.
   * @param principal - The administrator saving it.
   * @param body - The configuration.
   * @returns The saved schedule.
   */
  @Put()
  @Roles(...ADMINISTRATORS)
  save(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: PutAnalysisScheduleBody,
  ): Promise<AnalysisScheduleResource> {
    return this.schedules.save(tenant.id, principal.user.id, body);
  }
}
