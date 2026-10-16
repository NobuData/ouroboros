/**
 * The engine submits, reads and cancels a run's build (AJ.3,
 * [#265](https://github.com/NobuData/ouroboros/issues/265)). `run-builds.service.ts` is the
 * contract; this is its three routes, behind the internal key like every engine call.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { RunIdParams } from "../ingest/ingest.dto";
import { InternalOnly } from "../internal/internal.decorators";
import {
  RUN_BUILD_CANCEL_ROUTE,
  RUN_BUILD_ROUTE,
  RUN_BUILDS_ROUTE,
  RUNS_PATH,
} from "../internal/internal.paths";
import { CancelRunBuildDto, RunBuildParams, SubmitRunBuildDto } from "./run-builds.dto";
import { RunBuildsService, type RunBuildAnswer } from "./run-builds.service";

@InternalOnly()
@AllowAnonymous()
@Controller({ path: RUNS_PATH, version: VERSION_NEUTRAL })
export class RunBuildsController {
  /** @param builds - Where the contract is. */
  constructor(private readonly builds: RunBuildsService) {}

  /**
   * Submit a build stage's job to the farm.
   *
   * @param params - The run.
   * @param request - The stage and attempt, the pool, the pushed commit and the command.
   * @returns The job.
   */
  @Post(RUN_BUILDS_ROUTE)
  @HttpCode(HttpStatus.OK)
  async submit(
    @Param() params: RunIdParams,
    @Body() request: SubmitRunBuildDto,
  ): Promise<RunBuildAnswer> {
    return this.builds.submit(params.id, request);
  }

  /**
   * Where a run's build is now.
   *
   * @param params - The run and the job.
   * @returns The latest attempt.
   */
  @Get(RUN_BUILD_ROUTE)
  async read(@Param() params: RunBuildParams): Promise<RunBuildAnswer> {
    return this.builds.read(params.id, params.jobId);
  }

  /**
   * Give up on a run's build.
   *
   * @param params - The run and the job.
   * @param request - The key, the epoch and why.
   * @returns The latest attempt.
   */
  @Post(RUN_BUILD_CANCEL_ROUTE)
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param() params: RunBuildParams,
    @Body() request: CancelRunBuildDto,
  ): Promise<RunBuildAnswer> {
    return this.builds.cancel(params.id, params.jobId, request);
  }
}
