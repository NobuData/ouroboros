/**
 * `GET /api/v1/analyzer/measurements?repo=` — every applied suggestion's measurement and the
 * repository's calibration factors (BV.6, [#515](https://github.com/NobuData/ouroboros/issues/515);
 * mockup 18's Predicted vs Measured card, for BW.5 #520).
 *
 * Every member may read — a viewer may read the analyzer. **The workspace is the session's, never
 * the request's**; a repository the workspace has none of reads as empty.
 */

import { Controller, Get, Query } from "@nestjs/common";

import type { Organization } from "../../db/schema";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import { MeasurementsQuery } from "./measurement.dto";
import { MeasurementRepository } from "./measurement.repository";
import {
  CALIBRATION_FORMULA,
  calibrationResource,
  measurementResource,
  type MeasurementsResource,
} from "./measurement.resources";

@Controller("analyzer/measurements")
export class MeasurementController {
  /** @param measurements - The reads. */
  constructor(private readonly measurements: MeasurementRepository) {}

  /**
   * A repository's measurements, newest apply first, and its calibration with history.
   *
   * @param tenant - The workspace.
   * @param query - `{repo}`.
   * @returns The card's content.
   */
  @Get()
  async list(
    @CurrentTenant() tenant: Organization,
    @Query() query: MeasurementsQuery,
  ): Promise<MeasurementsResource> {
    const [rows, cells] = await Promise.all([
      this.measurements.measurements(tenant.id, query.repo, new Date()),
      this.measurements.calibration(tenant.id, query.repo),
    ]);

    return {
      repo: query.repo,
      formula: CALIBRATION_FORMULA,
      measurements: rows.map(measurementResource),
      calibration: cells.map(calibrationResource),
    };
  }
}
