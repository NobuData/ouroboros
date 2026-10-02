/**
 * `/api/v1/analyzer/runs` — the Build Analyzer's runs: *Run analysis now*, and the status and
 * progress the page polls (BV.1, [#510](https://github.com/NobuData/ouroboros/issues/510),
 * mockup 18's head and meta strip).
 *
 * **Who may do what.** Reading a run is every member's — a viewer may read the analyzer. Starting
 * one spends the workspace's build-farm data and compute, so it is an administrator's
 * (`owner`/`admin`), refused with the API's one `403` below that, and audited.
 *
 * **One running analysis per repository.** A second start while one runs is a `409
 * analysis_already_running` whose details name the run that is going — the UI says so and follows
 * it rather than queuing another.
 *
 * **The workspace is the session's, never the request's** — no `{orgId}` in the path; another
 * workspace's run is a `404`.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { AnalysisRunIdParams, LatestAnalysisQuery, StartAnalysisBody } from "./analysis.dto";
import type { AnalysisRunResource, LatestAnalysisResource } from "./analysis.resources";
import { AnalysisService } from "./analysis.service";

@Controller("analyzer/runs")
export class AnalysisController {
  /** @param analysis - The request side. */
  constructor(private readonly analysis: AnalysisService) {}

  /**
   * `POST /api/v1/analyzer/runs` — start an analysis now.
   *
   * @param tenant - The workspace.
   * @param principal - The administrator asking.
   * @param body - `{repo}`.
   * @returns `202` with the run, `running` in `assembling`; poll it for progress.
   */
  @Post()
  @Roles(...ADMINISTRATORS)
  @HttpCode(HttpStatus.ACCEPTED)
  start(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: StartAnalysisBody,
  ): Promise<AnalysisRunResource> {
    return this.analysis.runNow(tenant.id, principal.user.id, body.repo);
  }

  /**
   * `GET /api/v1/analyzer/runs/latest?repo=` — a repository's newest run.
   *
   * @param tenant - The workspace.
   * @param query - `{repo}`.
   * @returns `{run}`, null before the first analysis.
   */
  @Get("latest")
  latest(
    @CurrentTenant() tenant: Organization,
    @Query() query: LatestAnalysisQuery,
  ): Promise<LatestAnalysisResource> {
    return this.analysis.latest(tenant.id, query.repo);
  }

  /**
   * `GET /api/v1/analyzer/runs/{id}` — one run's status, phase, progress and manifest.
   *
   * @param tenant - The workspace.
   * @param params - The run.
   * @returns The run.
   */
  @Get(":id")
  read(
    @CurrentTenant() tenant: Organization,
    @Param() params: AnalysisRunIdParams,
  ): Promise<AnalysisRunResource> {
    return this.analysis.run(tenant.id, params.id);
  }
}
