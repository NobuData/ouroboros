/**
 * `/api/v1/insights/calibration` — the estimator calibration report (BI.4,
 * [#435](https://github.com/NobuData/ouroboros/issues/435)).
 *
 * **Every member may read it**, a viewer included: it is a number the Insights page prints and an
 * estimator issue cites. **The workspace is the session's, never the request's** — no `{orgId}`
 * in the path.
 */

import { Controller, Get, Query } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { CalibrationQuery } from "./calibration.dto";
import { DEFAULT_CALIBRATION_WINDOW, type CalibrationReport } from "./calibration.rules";
import { CalibrationService } from "./calibration.service";

@Controller("insights/calibration")
export class CalibrationController {
  /** @param calibration - The service. */
  constructor(private readonly calibration: CalibrationService) {}

  /**
   * The report for a window ending now.
   *
   * @param tenant - The workspace.
   * @param query - The window; `30d` when absent.
   * @returns The headline, the unestimated count and the effort slices with bias direction.
   */
  @Get()
  read(
    @CurrentTenant() tenant: Organization,
    @Query() query: CalibrationQuery,
  ): Promise<CalibrationReport> {
    return this.calibration.report(tenant.id, query.window ?? DEFAULT_CALIBRATION_WINDOW);
  }
}
