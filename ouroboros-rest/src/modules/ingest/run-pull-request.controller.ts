/**
 * The engine asks to open a live run's draft pull request (DI.3,
 * [#1311](https://github.com/NobuData/ouroboros/issues/1311)). `run-pull-request.service.ts` is
 * the contract; this is its one route, behind the internal key like every engine call.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { InternalOnly } from "../internal/internal.decorators";
import { RUN_PULL_REQUEST_ROUTE, RUNS_PATH } from "../internal/internal.paths";
import { RunIdParams } from "./ingest.dto";
import { OpenPullRequestDto } from "./run-pull-request.dto";
import type { PullRequestOpenedResource } from "./run-pull-request.resources";
import { RunPullRequestService } from "./run-pull-request.service";

@InternalOnly()
@AllowAnonymous()
@Controller({ path: RUNS_PATH, version: VERSION_NEUTRAL })
export class RunPullRequestController {
  /** @param pullRequests - Where the contract is. */
  constructor(private readonly pullRequests: RunPullRequestService) {}

  /**
   * Open the run's draft pull request — or answer the one it already has.
   *
   * @param params - The run.
   * @param request - The epoch and the key.
   * @returns The PR, always a draft, and whether this request opened it.
   */
  @Post(RUN_PULL_REQUEST_ROUTE)
  @HttpCode(HttpStatus.OK)
  async open(
    @Param() params: RunIdParams,
    @Body() request: OpenPullRequestDto,
  ): Promise<PullRequestOpenedResource> {
    return this.pullRequests.open(params.id, request);
  }
}
