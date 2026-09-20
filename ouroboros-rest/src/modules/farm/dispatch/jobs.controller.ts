/**
 * `/api/v1/farm/jobs` — submit a build, and cancel one.
 *
 * AH.4 ([#252](https://github.com/NobuData/ouroboros/issues/252)). Decision **B6** scopes the
 * MVP's builds to the ones people and the API submit, and these two routes are that scope; AI.5's
 * submit dialog (#260) is their first client.
 *
 * **The workspace is the session's, never the request's** — the same sentence every controller in
 * this service opens with, because it is the same property: the tenant guard resolves and
 * membership-checks the active organization, and these handlers read what it established. A job
 * of another workspace is a `404`, whoever asks.
 *
 * **Both are `member` and above** (`CONTRIBUTORS`). Submitting a build is ordinary work, not
 * administration — it is what the farm is for — and a person who may submit one may stop it.
 * Enrolling machines, draining them and editing pools stay an administrator's (AH.2, AH.6).
 *
 * **A submission names who made it.** The session's user is handed to the service for the
 * audit trail (`runner.job_submitted`, #260) — read from the session, like the workspace, and
 * never from the body.
 */

import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../../auth/principal";
import type { Organization } from "../../db/schema";
import { CONTRIBUTORS, Roles } from "../../tenancy/roles.guard";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import { SubmitBuildJobDto } from "./jobs.dto";
import type { BuildJobResource } from "./jobs.resources";
import { FarmJobsService } from "./jobs.service";

@Controller("farm/jobs")
export class FarmJobsController {
  /**
   * @param jobs - Submission and cancellation.
   */
  constructor(private readonly jobs: FarmJobsService) {}

  /**
   * Submit a build.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param principal - Who is submitting, for the audit trail.
   * @param request - The pool, repository, ref, commit and — or the pool's default — command.
   * @returns The job, `201`. Dispatch has been kicked, so it may already be offered.
   */
  @Post()
  @Roles(...CONTRIBUTORS)
  submit(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() request: SubmitBuildJobDto,
  ): Promise<BuildJobResource> {
    return this.jobs.submit(tenant.id, principal.user.id, request);
  }

  /**
   * Cancel a build — waiting, offered, accepted or running — and tell the runner holding it.
   *
   * `POST` to a sub-resource rather than `DELETE`, because nothing is removed: the job keeps its
   * row, its number and its history, and ends `canceled`.
   *
   * @param tenant - The workspace.
   * @param id - The job.
   * @returns The job, `canceled`.
   */
  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  cancel(
    @CurrentTenant() tenant: Organization,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<BuildJobResource> {
    return this.jobs.cancel(tenant.id, id);
  }
}
