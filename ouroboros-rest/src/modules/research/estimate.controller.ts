/**
 * `POST /research/estimates` — the composer's re-estimation call
 * ([#622](https://github.com/NobuData/ouroboros/issues/622)).
 *
 * Called on every kind, depth or tool change, and answering the estimate line and the
 * researcher pill together, so the two can never describe different routing states. `POST` for a
 * read, as `routing/simulate` is: nothing is created (hence `200`), and a tool list is a shape
 * query strings spell inconsistently. Any member may ask — an estimate changes nothing.
 */

import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { EstimateInvestigationDto } from "./estimate.dto";
import { ResearchEstimateService } from "./estimate.service";
import type { ScopeEstimateResource } from "./resources";

@Controller("research")
export class ResearchEstimateController {
  /** @param estimates - The estimator. */
  constructor(private readonly estimates: ResearchEstimateService) {}

  /**
   * Estimates a prospective investigation.
   *
   * @param tenant - The session's workspace.
   * @param body - Kind, depth and optional tools.
   * @returns The estimate, the researcher and the composer's line.
   */
  @Post("estimates")
  @HttpCode(HttpStatus.OK)
  estimate(
    @CurrentTenant() tenant: Organization,
    @Body() body: EstimateInvestigationDto,
  ): Promise<ScopeEstimateResource> {
    return this.estimates.estimate(tenant.id, body);
  }
}
