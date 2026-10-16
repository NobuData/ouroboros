/**
 * `/internal/runs/:id/{start,heartbeat,checkpoint,finish}` — the engine executing a run (#160,
 * ADR decision A).
 *
 * Thin, like `ingest.controller.ts` beside it and for the same reasons: the policy is
 * `run-execution.service.ts`'s, the shapes are `run-execution.dto.ts`'s and
 * `run-execution.resources.ts`'s. The decorators are the internal surface's — `@InternalOnly()`
 * puts the routes behind `X-Ouro-Internal-Key`, `@AllowAnonymous()` keeps the session guard from
 * answering a worker first, and `VERSION_NEUTRAL` keeps them outside `/api/v1`.
 *
 * Every route answers `200`: each acts on a run that exists, and none creates a resource with a
 * URL of its own.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { InternalOnly } from "../internal/internal.decorators";
import {
  RUN_CHECKPOINT_ROUTE,
  RUN_FINISH_ROUTE,
  RUN_HEARTBEAT_ROUTE,
  RUN_START_ROUTE,
  RUNS_PATH,
} from "../internal/internal.paths";
import { RunIdParams } from "./ingest.dto";
import { CheckpointRunDto, FinishRunDto, HeartbeatDto, StartRunDto } from "./run-execution.dto";
import type {
  CheckpointSavedResource,
  HeartbeatResource,
  RunFinishedResource,
  RunStartedResource,
} from "./run-execution.resources";
import { RunExecutionService } from "./run-execution.service";

@InternalOnly()
@AllowAnonymous()
@Controller({ path: RUNS_PATH, version: VERSION_NEUTRAL })
export class RunExecutionController {
  /** @param execution - Where the contract is. */
  constructor(private readonly execution: RunExecutionService) {}

  /**
   * Start (or restart) executing a run under a new epoch.
   *
   * @param params - The run.
   * @param request - The worker.
   * @returns The epoch and everything the interpreter needs.
   */
  @Post(RUN_START_ROUTE)
  @HttpCode(HttpStatus.OK)
  async start(
    @Param() params: RunIdParams,
    @Body() request: StartRunDto,
  ): Promise<RunStartedResource> {
    return this.execution.start(params.id, request);
  }

  /**
   * The worker holding the epoch is still executing the run.
   *
   * @param params - The run.
   * @param request - The epoch.
   * @returns The epoch and the heartbeat's time.
   */
  @Post(RUN_HEARTBEAT_ROUTE)
  @HttpCode(HttpStatus.OK)
  async heartbeat(
    @Param() params: RunIdParams,
    @Body() request: HeartbeatDto,
  ): Promise<HeartbeatResource> {
    return this.execution.heartbeat(params.id, request);
  }

  /**
   * Save the interpreter's resume state.
   *
   * @param params - The run.
   * @param request - The epoch, the state, and the base commit the first time.
   * @returns When it was saved.
   */
  @Put(RUN_CHECKPOINT_ROUTE)
  @HttpCode(HttpStatus.OK)
  async checkpoint(
    @Param() params: RunIdParams,
    @Body() request: CheckpointRunDto,
  ): Promise<CheckpointSavedResource> {
    return this.execution.checkpoint(params.id, request);
  }

  /**
   * End the run through one of the workflow's terminals.
   *
   * @param params - The run.
   * @param request - The epoch, the key, the outcome and the reason.
   * @returns The run's status and any requeued item.
   */
  @Post(RUN_FINISH_ROUTE)
  @HttpCode(HttpStatus.OK)
  async finish(
    @Param() params: RunIdParams,
    @Body() request: FinishRunDto,
  ): Promise<RunFinishedResource> {
    return this.execution.finish(params.id, request);
  }
}
