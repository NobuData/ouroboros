/**
 * `/internal/research/investigations/:id/*` — where the engine's investigation loop writes
 * (CM.1, [#620](https://github.com/NobuData/ouroboros/issues/620)).
 *
 * Four routes, one per thing the loop leaves behind: `start` claims or resumes a run,
 * `checkpoint` saves its state, `brief` delivers, `finish` ends it as failed or cancelled. The
 * decorators are the internal surface's, as on every engine-facing route: `@InternalOnly()`
 * puts it behind `X-Ouro-Internal-Key`, and `@AllowAnonymous()` keeps the browser session guard
 * from answering first. The workspace is never named by the caller — it is the investigation's.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { InternalOnly } from "../../internal/internal.decorators";
import {
  INVESTIGATION_BRIEF_ROUTE,
  INVESTIGATION_CHECKPOINT_ROUTE,
  INVESTIGATION_FINISH_ROUTE,
  INVESTIGATION_START_ROUTE,
  RESEARCH_INVESTIGATIONS_PATH,
} from "../../internal/internal.paths";
import { BriefDto, CheckpointDto, FinishDto, StartDto } from "./investigation-loop.dto";
import {
  InvestigationLoopService,
  type CheckpointResource,
  type EndedResource,
  type StartedResource,
} from "./investigation-loop.service";

@InternalOnly()
@AllowAnonymous()
@Controller({ path: RESEARCH_INVESTIGATIONS_PATH, version: VERSION_NEUTRAL })
export class InvestigationsInternalController {
  /** @param loop - The loop's control-plane half. */
  constructor(private readonly loop: InvestigationLoopService) {}

  /**
   * Claim a queued investigation, or resume a running one as a new attempt.
   *
   * @param id - The investigation.
   * @param request - The researcher, its alias and the engine task.
   * @returns The attempt, the checkpoint to continue from and the ledger so far.
   */
  @Post(INVESTIGATION_START_ROUTE)
  @HttpCode(HttpStatus.OK)
  start(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() request: StartDto,
  ): Promise<StartedResource> {
    return this.loop.start(id, request);
  }

  /**
   * Save the loop's state after a step.
   *
   * @param id - The investigation.
   * @param request - The state, the working time and the usage since the last write.
   * @returns Whether a person asked for the run to stop.
   */
  @Put(INVESTIGATION_CHECKPOINT_ROUTE)
  checkpoint(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() request: CheckpointDto,
  ): Promise<CheckpointResource> {
    return this.loop.checkpoint(id, request);
  }

  /**
   * Deliver the brief, its claims and the playbook's deliverable inputs.
   *
   * @param id - The investigation.
   * @param request - The delivery.
   * @returns The brief's version and the actuals recorded.
   */
  @Post(INVESTIGATION_BRIEF_ROUTE)
  @HttpCode(HttpStatus.OK)
  brief(@Param("id", ParseUUIDPipe) id: string, @Body() request: BriefDto): Promise<EndedResource> {
    return this.loop.deliver(id, request);
  }

  /**
   * End the run as failed or cancelled, keeping what it gathered.
   *
   * @param id - The investigation.
   * @param request - The outcome and the final state.
   * @returns The actuals recorded.
   */
  @Post(INVESTIGATION_FINISH_ROUTE)
  @HttpCode(HttpStatus.OK)
  finish(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() request: FinishDto,
  ): Promise<EndedResource> {
    return this.loop.finish(id, request);
  }
}
