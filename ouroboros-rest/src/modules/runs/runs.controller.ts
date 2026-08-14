/**
 * `/api/v1/runs` — the paged listings behind mockup 02's *Open run console →* and
 * *All issues →* links, and the detail a card links to
 * ([#71](https://github.com/NobuData/ouroboros/issues/71)).
 *
 * **The workspace is the session's, never the request's** — the same sentence the dashboard
 * controller opens with, because it is the same property: no `{orgId}` in the path, the
 * tenant guard resolves and membership-checks the active organization, and this handler
 * reads what it established. The listings are the aggregate's slices without their card
 * limits; the shapes are identical because the mapper is.
 *
 * Sessions are required without anything here saying so — the global guard — and a tenant
 * is required *because* nothing here says otherwise: no `@TenantOptional()`, so a session
 * acting in no workspace is a `400 organization_required` before either handler runs.
 */

import { Controller, Get, Param, Query } from "@nestjs/common";

import type { Organization } from "../db/schema";
import type { RunSummary } from "../dashboard/resources";
import type { Page } from "../tenancy/pagination";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { ListRunsQuery, RunParams } from "./runs.dto";
import { RunsService } from "./runs.service";

@Controller("runs")
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  /**
   * One page of the workspace's runs — active in lifecycle order, terminal newest first.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param query - Family (required), repository filter and window (optional).
   * @returns The page, per the #31 convention.
   */
  @Get()
  list(
    @CurrentTenant() tenant: Organization,
    @Query() query: ListRunsQuery,
  ): Promise<Page<RunSummary>> {
    return this.runs.list(tenant.id, query);
  }

  /**
   * One run, in the same shape every listing row has.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The run's id, validated as a uuid by the pipe.
   * @returns The run.
   */
  @Get(":id")
  read(@CurrentTenant() tenant: Organization, @Param() params: RunParams): Promise<RunSummary> {
    return this.runs.read(tenant.id, params.id);
  }
}
