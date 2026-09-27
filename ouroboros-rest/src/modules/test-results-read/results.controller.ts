/**
 * The Test Results page's reads and the artifact download (AT.5,
 * [#333](https://github.com/NobuData/ouroboros/issues/333)):
 *
 * ```
 * GET /api/v1/runs/:id/test-runs                      the attempts timeline, strips, next step
 * GET /api/v1/test-runs/:id                           the page payload of one attempt
 * GET /api/v1/test-runs/:id/cases/:caseId/failure     one case's failure detail
 * GET /api/v1/artifacts/:id                           the file, streamed through the store
 * ```
 *
 * **Every member's, a `viewer` included** — they are reads. The workspace is the session's: the
 * tenant guard resolves and membership-checks it, and anything of another workspace is a `404`.
 *
 * **A download streams through the driver.** The response is the store's stream with the row's
 * size, a content type from the name, `inline` for text kinds and `attachment` for the rest, and
 * the safety headers — no storage path, key or driver name is ever in it.
 */

import { Controller, Get, Param, Res, StreamableFile } from "@nestjs/common";
import { IsUUID } from "class-validator";

import type { Organization } from "../db/schema";
import type { HeaderResponse } from "../farm/logs/logs.controller";
import { RunParams } from "../runs/runs.dto";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { TestCaseParams, TestRunParams } from "../triage/triage.dto";
import { ARTIFACT_SAFETY_HEADERS } from "./artifact.serving";
import type {
  CaseFailureResource,
  TestRunPageResource,
  TestRunTimelineResource,
} from "./results.resources";
import { ResultsService } from "./results.service";

/** The path of `GET /api/v1/artifacts/{id}`. */
export class ArtifactParams {
  /** `test_artifacts.id`, a uuid (V055). Anything else is a `422`, not a probe's `404`. */
  @IsUUID()
  id!: string;
}

@Controller()
export class ResultsController {
  /** @param results - The reads. */
  constructor(private readonly results: ResultsService) {}

  /**
   * The attempts timeline of a run.
   *
   * @param tenant - The workspace.
   * @param params - The run.
   * @returns Its attempts, each with its strip, and the next step.
   */
  @Get("runs/:id/test-runs")
  timeline(
    @CurrentTenant() tenant: Organization,
    @Param() params: RunParams,
  ): Promise<TestRunTimelineResource> {
    return this.results.timeline(tenant.id, params.id);
  }

  /**
   * One attempt's page payload.
   *
   * @param tenant - The workspace.
   * @param params - The attempt.
   * @returns Its suites, cases, measurements, classifications, artifacts and coverage.
   */
  @Get("test-runs/:id")
  page(
    @CurrentTenant() tenant: Organization,
    @Param() params: TestRunParams,
  ): Promise<TestRunPageResource> {
    return this.results.page(tenant.id, params.id);
  }

  /**
   * One case's failure detail.
   *
   * @param tenant - The workspace.
   * @param params - The attempt and the case.
   * @returns The message, log excerpt and path.
   */
  @Get("test-runs/:id/cases/:caseId/failure")
  failure(
    @CurrentTenant() tenant: Organization,
    @Param() params: TestCaseParams,
  ): Promise<CaseFailureResource> {
    return this.results.failure(tenant.id, params.id, params.caseId);
  }

  /**
   * An artifact's bytes.
   *
   * @param tenant - The workspace.
   * @param params - The artifact.
   * @param response - For the safety headers.
   * @returns The file, streamed from the store.
   */
  @Get("artifacts/:id")
  async download(
    @CurrentTenant() tenant: Organization,
    @Param() params: ArtifactParams,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<StreamableFile> {
    const file = await this.results.download(tenant.id, params.id);

    for (const [name, value] of Object.entries(ARTIFACT_SAFETY_HEADERS)) {
      response.setHeader(name, value);
    }

    return new StreamableFile(file.body, {
      type: file.presentation.contentType,
      disposition: file.presentation.contentDisposition,
      length: file.sizeBytes,
    });
  }
}
