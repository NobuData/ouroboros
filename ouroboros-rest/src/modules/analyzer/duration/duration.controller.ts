/**
 * `GET /api/v1/analyzer/duration?repo=` — a repository's build-duration series and the
 * change-points detected on it (BW.2, [#517](https://github.com/NobuData/ouroboros/issues/517);
 * mockup 18's annotated duration chart and the Details sheet behind each chip).
 *
 * Every member may read — a viewer may read the analyzer. **The workspace is the session's, never
 * the request's**; a repository the workspace has none of reads as an empty chart.
 */

import { Controller, Get, Query } from "@nestjs/common";

import type { Organization } from "../../db/schema";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import { DurationChartQuery } from "./duration.dto";
import type { DurationChartResource } from "./duration.resources";
import { DurationChartService } from "./duration.service";

@Controller("analyzer/duration")
export class DurationChartController {
  /** @param charts - The read. */
  constructor(private readonly charts: DurationChartService) {}

  /**
   * The newest annotated run's daily medians and its ranked, evidenced change-points.
   *
   * @param tenant - The workspace.
   * @param query - `{repo}`.
   * @returns The chart's content.
   */
  @Get()
  read(
    @CurrentTenant() tenant: Organization,
    @Query() query: DurationChartQuery,
  ): Promise<DurationChartResource> {
    return this.charts.chart(tenant.id, query.repo);
  }
}
