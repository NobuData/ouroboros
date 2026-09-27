/**
 * `/api/v1/flakes/…` — the flake state routes (AT.3,
 * [#331](https://github.com/NobuData/ouroboros/issues/331)).
 *
 * Reads only, and every member's, a `viewer` included. **The workspace is the session's, never the
 * request's**: the tenant guard resolves and membership-checks it, and this controller reads what
 * it established — so a case key from another workspace is a `404`, not a leak.
 */

import { Controller, Get, Param } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { FlakeStateService } from "./flake-state.service";
import { CaseKeyParams } from "./flakes.dto";
import type { CaseFlakeResource, FlakeSummaryResource } from "./flakes.resources";

@Controller("flakes")
export class FlakesController {
  /** @param state - Where the reads are. */
  constructor(private readonly state: FlakeStateService) {}

  /**
   * The workspace's `watching` count, candidates and last nightly pass.
   *
   * @param tenant - The workspace.
   * @returns The summary.
   */
  @Get("summary")
  summary(@CurrentTenant() tenant: Organization): Promise<FlakeSummaryResource> {
    return this.state.summary(tenant.id);
  }

  /**
   * One case's flake and quarantine state.
   *
   * @param tenant - The workspace.
   * @param params - The case key.
   * @returns The state.
   */
  @Get("cases/:caseKey")
  caseState(
    @CurrentTenant() tenant: Organization,
    @Param() params: CaseKeyParams,
  ): Promise<CaseFlakeResource> {
    return this.state.caseState(tenant.id, params.caseKey);
  }
}
