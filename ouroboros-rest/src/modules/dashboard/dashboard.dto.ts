/**
 * `GET /api/v1/dashboard`'s query (DJ.2, [#1315](https://github.com/NobuData/ouroboros/issues/1315)).
 */

import { IsIn, IsOptional } from "class-validator";

import { ORIGIN_FILTERS, type OriginFilter } from "../insights/metrics/metrics.origin";

/** What the dashboard may be asked for. */
export class DashboardQuery {
  /**
   * Which data origin the aggregates count: `live` when omitted, or `simulated`, `seeded`, or
   * `all` — every origin summed, and the answer marked `mixed`.
   */
  @IsOptional()
  @IsIn(ORIGIN_FILTERS)
  origin?: OriginFilter;
}
