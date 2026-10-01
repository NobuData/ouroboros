/**
 * `GET /api/v1/insights` — mockup 15's whole page in one payload (BJ.2,
 * [#438](https://github.com/NobuData/ouroboros/issues/438)).
 *
 * ```
 * GET /api/v1/insights?range=7d|30d|90d&repo=owner/name    any member
 * ```
 *
 * Every member may read it: the page is what the workspace measured about itself. The workspace
 * is the session's, never the request's — there is no `{orgId}` in the path — so another
 * workspace's page is not addressable, and naming one in the tenant header is the tenant guard's
 * `404 tenant_not_found`, never a `403`.
 */

import { Controller, Get, Query } from "@nestjs/common";

import type { Organization } from "../../db/schema";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import { InsightsQuery } from "./page.dto";
import type { InsightsResource } from "./page.resources";
import { DEFAULT_INSIGHTS_RANGE, InsightsPageService } from "./page.service";

@Controller("insights")
export class InsightsPageController {
  constructor(private readonly page: InsightsPageService) {}

  /**
   * The Insights page over a range.
   *
   * @param tenant - The workspace.
   * @param query - `?range=` and, optionally, `?repo=owner/name`.
   * @returns The head, KPI row, series, bar cards, performance strip, flaky card, scoreboard and
   *   DORA cells — each number with its methodology, each insight line computed.
   */
  @Get()
  read(
    @CurrentTenant() tenant: Organization,
    @Query() query: InsightsQuery,
  ): Promise<InsightsResource> {
    return this.page.read(tenant.id, {
      range: query.range ?? DEFAULT_INSIGHTS_RANGE,
      repo: query.repo,
    });
  }
}
