/**
 * `GET /api/v1/loop/readiness?repository=…&workflow=…[&issue=…]` — everything a first live loop
 * needs, checked for one repository and workflow (DK.1,
 * [#1318](https://github.com/NobuData/ouroboros/issues/1318)).
 *
 * Any member may read it, as for the capability report: the wizard's last step renders it (DK.2),
 * and a viewer sees the same honest list an administrator does. It names no secret — a token's
 * permission, never the token. The workspace is the session's.
 */

import { Controller, Get, Query } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import type { LoopReadinessResource } from "./readiness";
import { LoopReadinessQuery } from "./readiness.dto";
import { ReadinessService } from "./readiness.service";

@Controller("loop/readiness")
export class LoopReadinessController {
  /**
   * @param readiness - Computes the preflight.
   */
  constructor(private readonly readiness: ReadinessService) {}

  /**
   * The preflight for the session's workspace.
   *
   * @param tenant - The workspace.
   * @param query - The repository, the workflow and, optionally, the issue.
   * @returns The ordered checks, `ready`, and the estimate; `404` for an unknown repository or a
   *   named issue the backlog does not mirror.
   */
  @Get()
  read(
    @CurrentTenant() tenant: Organization,
    @Query() query: LoopReadinessQuery,
  ): Promise<LoopReadinessResource> {
    return this.readiness.read(tenant.id, query);
  }
}
