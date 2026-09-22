/**
 * `/internal/runs/:id/controls/…` — the executor's half of the control queue (AP.4,
 * [#306](https://github.com/NobuData/ouroboros/issues/306)), on the internal channel
 * ([#51](https://github.com/NobuData/ouroboros/issues/51)/[#52](https://github.com/NobuData/ouroboros/issues/52)).
 *
 * The same decorators as `ingest.controller.ts`, for the same reasons: `@InternalOnly()` is the
 * shared-secret guard's trigger, `@AllowAnonymous()` exempts the route from the *session* (not
 * from authentication), and `VERSION_NEUTRAL` keeps these paths outside `/api/v1`. Both
 * principals, the executor and the simulator, reach both routes: acknowledging a control is
 * the same act whoever is driving the run.
 *
 * **Two `200`s.** The fetch is a `POST` because claiming *is* delivery, and it creates no
 * resource. The ack answers with the control as it now stands.
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
import { CONTROL_ACK_ROUTE, CONTROLS_FETCH_ROUTE, RUNS_PATH } from "../internal/internal.paths";
import { AckControlDto, ControlAckParams, RunControlsParams } from "./controls.dto";
import type { ControlsFetchedResource, RunControlResource } from "./controls.resources";
import { ControlsService } from "./controls.service";

@InternalOnly()
@AllowAnonymous()
@Controller({ path: RUNS_PATH, version: VERSION_NEUTRAL })
export class ControlsInternalController {
  /** @param controls - Where the policy is. */
  constructor(private readonly controls: ControlsService) {}

  /**
   * Claim every pending control of this run.
   *
   * @param params - The run.
   * @returns The controls, oldest first, now `delivered`.
   */
  @Post(CONTROLS_FETCH_ROUTE)
  @HttpCode(HttpStatus.OK)
  fetch(@Param() params: RunControlsParams): Promise<ControlsFetchedResource> {
    return this.controls.fetch(params.id);
  }

  /**
   * Acknowledge one control with the effect it had.
   *
   * @param params - The run and the control.
   * @param request - The effect, and for a steer the attempt it landed on.
   * @returns The control, `acked`.
   */
  @Post(CONTROL_ACK_ROUTE)
  @HttpCode(HttpStatus.OK)
  ack(
    @Param() params: ControlAckParams,
    @Body() request: AckControlDto,
  ): Promise<RunControlResource> {
    return this.controls.ack(params.id, params.controlId, request);
  }
}
