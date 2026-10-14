/**
 * `GET /api/v1/loop/capabilities` — which loop stages are live in this deployment and this
 * workspace, and why not (DG.2, [#1300](https://github.com/NobuData/ouroboros/issues/1300)).
 *
 * Any member may read it: it is what the product's own copy is driven by (DG.3), so a viewer
 * sees the same honest state an administrator does. The workspace is the session's.
 */

import { Controller, Get } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import type { LoopCapabilitiesResource } from "./loop.capabilities";
import { LoopCapabilitiesService } from "./loop.service";

@Controller("loop/capabilities")
export class LoopCapabilitiesController {
  /**
   * @param capabilities - Computes the report.
   */
  constructor(private readonly capabilities: LoopCapabilitiesService) {}

  /**
   * The report for the session's workspace.
   *
   * @param tenant - The workspace.
   * @returns The report.
   */
  @Get()
  read(@CurrentTenant() tenant: Organization): Promise<LoopCapabilitiesResource> {
    return this.capabilities.read(tenant.id);
  }
}
