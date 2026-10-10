/**
 * `POST /internal/dry-runs/:id/replay-estimates` — where the engine's dry-run harness asks how
 * long a build or a test stage would take (CD.3,
 * [#561](https://github.com/NobuData/ouroboros/issues/561)).
 *
 * The harness's `build` and `run_tests` tools are replay stubs (CD.2, #560): they run nothing and
 * call this instead. The decorators are the internal surface's, as on every engine-facing route:
 * `@InternalOnly()` puts it behind `X-Ouro-Internal-Key`, and `@AllowAnonymous()` keeps the
 * browser session guard from answering first. The workspace and the repository are never named
 * by the caller — they are the dry run's.
 *
 * It reads and writes nothing else: recording the row is dry-run orchestration's (CD.4, #562),
 * which is why the answer carries the row ready to store.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { InternalOnly } from "../internal/internal.decorators";
import { DRY_RUNS_PATH, DRY_RUN_REPLAY_ESTIMATES_ROUTE } from "../internal/internal.paths";
import { ReplayEstimateDto } from "./replay.dto";
import { ReplayEstimateService, type ReplayEstimateResource } from "./replay.service";

@InternalOnly()
@AllowAnonymous()
@Controller({ path: DRY_RUNS_PATH, version: VERSION_NEUTRAL })
export class ReplayEstimatesInternalController {
  /** @param estimates - The estimators. */
  constructor(private readonly estimates: ReplayEstimateService) {}

  /**
   * Estimate one infra stage of a dry run from the farm's own history.
   *
   * @param id - The dry run.
   * @param request - The stage: a build's pool and command, or a test's suite set.
   * @returns The estimate with its basis — or insufficient history — and the stage row to record.
   */
  @Post(DRY_RUN_REPLAY_ESTIMATES_ROUTE)
  @HttpCode(HttpStatus.OK)
  estimate(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() request: ReplayEstimateDto,
  ): Promise<ReplayEstimateResource> {
    return this.estimates.estimate(id, request);
  }
}
