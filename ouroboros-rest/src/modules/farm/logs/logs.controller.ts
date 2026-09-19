/**
 * `GET /api/v1/farm/jobs/:id/log?after=` — a build log, a page at a time.
 *
 * AH.5 ([#253](https://github.com/NobuData/ouroboros/issues/253)). The live log card (AI.6, #261)
 * is its first reader and mockup 10's **Full log ↗** its next.
 *
 * **Every member may read it** — no `@Roles`: a build's output is the workspace's to look at, as
 * the farm page is. The workspace is the session's, so another workspace's job is a `404`.
 *
 * **The polling contract's headers** (`docs/ARCHITECTURE.md` § 5.4): `Cache-Control: private,
 * no-cache` — one workspace's output, never held by a shared cache, revalidated before reuse — and
 * `X-Ouro-Poll-After`, two seconds while the build runs and the contract's fifteen after. Set in
 * the handler rather than by `@Header()`, so a refusal does not go out carrying them.
 */

import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from "@nestjs/common";

import type { Organization } from "../../db/schema";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import { POLL_AFTER } from "../../dashboard/dashboard.controller";
import { ReadLogQuery } from "./logs.dto";
import type { BuildLogResource } from "./logs.resources";
import { FarmLogsService } from "./logs.service";

/** The part of a platform response this controller writes. */
export interface HeaderResponse {
  /** Set a header, replacing any previous value. */
  setHeader(name: string, value: string): unknown;
}

@Controller("farm/jobs")
export class FarmLogsController {
  /**
   * @param logs - The read.
   */
  constructor(private readonly logs: FarmLogsService) {}

  /**
   * One page of a build job's log.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param id - The job.
   * @param query - `?after=`, the offset to read from; 0 when absent.
   * @param response - For the polling contract's headers, set once there is a page.
   * @returns The page.
   */
  @Get(":id/log")
  async read(
    @CurrentTenant() tenant: Organization,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ReadLogQuery,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<BuildLogResource> {
    const page = await this.logs.read(tenant.id, id, query.after ?? 0);

    response.setHeader("Cache-Control", "private, no-cache");
    response.setHeader(POLL_AFTER, String(page.pollAfter));

    return page;
  }
}
