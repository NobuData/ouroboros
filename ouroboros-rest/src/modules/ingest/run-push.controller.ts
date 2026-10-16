/**
 * The engine asks to push a run's branch, and reports how the push ended (DI.2,
 * [#1310](https://github.com/NobuData/ouroboros/issues/1310)). `run-push.service.ts` is the
 * contract; this is its two routes, behind the internal key like every engine call.
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
import { RUN_PUSH_RESULT_ROUTE, RUN_PUSH_ROUTE, RUNS_PATH } from "../internal/internal.paths";
import { RunIdParams } from "./ingest.dto";
import { ReportPushResultDto, RequestPushDto } from "./run-push.dto";
import type { PushGrantResource, PushRecordedResource } from "./run-push.resources";
import { RunPushService } from "./run-push.service";

@InternalOnly()
@AllowAnonymous()
@Controller({ path: RUNS_PATH, version: VERSION_NEUTRAL })
export class RunPushController {
  /** @param pushes - Where the contract is. */
  constructor(private readonly pushes: RunPushService) {}

  /**
   * Ask to push the run's branch: the refusals, then one refspec and a one-call credential.
   *
   * @param params - The run.
   * @param request - The branch, the commit and the change-set it publishes.
   * @returns The grant.
   */
  @Post(RUN_PUSH_ROUTE)
  @HttpCode(HttpStatus.OK)
  async push(
    @Param() params: RunIdParams,
    @Body() request: RequestPushDto,
  ): Promise<PushGrantResource> {
    return this.pushes.grant(params.id, request);
  }

  /**
   * Report how a granted push ended.
   *
   * @param params - The run.
   * @param request - The outcome, and the commit or the host's reason.
   * @returns `{recorded: true}`.
   */
  @Post(RUN_PUSH_RESULT_ROUTE)
  @HttpCode(HttpStatus.OK)
  async result(
    @Param() params: RunIdParams,
    @Body() request: ReportPushResultDto,
  ): Promise<PushRecordedResource> {
    return this.pushes.recordResult(params.id, request);
  }
}
