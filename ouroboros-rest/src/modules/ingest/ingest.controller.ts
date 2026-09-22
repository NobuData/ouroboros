/**
 * `/internal/runs` — the six routes every executor reports through.
 *
 * Thin, like `credentials.controller.ts` and for the same reasons. The policy is
 * `ingest.service.ts`'s, the shapes are `ingest.dto.ts`'s and `ingest.resources.ts`'s, the
 * authentication is `internal.guard.ts`'s, and what is left here is the wiring plus four
 * decorators that each say something:
 *
 *   * **`@InternalOnly()`** — the guard's trigger, and what tells `route.table.fixture.ts`
 *     which of the three refusals to expect from these routes.
 *   * **`@AllowAnonymous()`** — *no session*, which is not *no authentication*. The caller is
 *     a worker process; without this the global session guard would refuse it before the
 *     internal guard ever ran, and the answer would be `401 Sign in to continue` — advice a
 *     worker cannot take.
 *   * **`VERSION_NEUTRAL`** — these paths sit outside `/api/v1`; `internal.paths.ts` is where
 *     that decision is argued.
 *   * **`@CallingPrincipal()`**, on one handler. Opening a run is the only operation whose
 *     answer depends on *who* asked, because decision R4's watermark follows the principal.
 *     Every other route takes the run's word for it — V046's `run_events_append()` raises
 *     each entry's flag to the run's own — so the principal is read exactly where it is
 *     decided and nowhere else.
 *
 * ---------------------------------------------------------------------------
 * **Five `200`s and one `201`.** `POST /internal/runs` creates a resource with an identity, so
 * it answers `201`. The other five report *against* a run that already exists: they create
 * rows, but no URL, and `201` would be a promise about a thing this service does not serve —
 * the reads are AP.2's (#304), under `/api/v1/runs/:id`, where a browser can reach them.
 *
 * **`PUT` for the change-set and `POST` for everything else**, and the verb is the semantics
 * rather than a style: the change-set report *replaces* what the run's change-set holds, and
 * the other four append. A `PUT` that appended, or a `POST` that replaced, would be the one
 * mistake in this contract that nobody notices for a week — V047 says as much about the
 * counts.
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

import { CallingPrincipal, InternalOnly } from "../internal/internal.decorators";
import {
  COMMITS_ROUTE,
  EVENTS_ROUTE,
  FILES_ROUTE,
  RESOURCES_ROUTE,
  RUNS_PATH,
  STAGE_TRANSITIONS_ROUTE,
} from "../internal/internal.paths";
import { isSimulatedPrincipal, type InternalPrincipal } from "../internal/internal.principal";
import {
  IngestEventsDto,
  OpenRunDto,
  ReportCommitsDto,
  ReportFilesDto,
  ReportResourcesDto,
  RunIdParams,
  StageTransitionDto,
} from "./ingest.dto";
import type {
  ChangeSetResource,
  CommitsAppendedResource,
  EventsAppendedResource,
  ResourcesReportedResource,
  RunOpenedResource,
  StageTransitionResource,
} from "./ingest.resources";
import { IngestService } from "./ingest.service";

@InternalOnly()
@AllowAnonymous()
@Controller({ path: RUNS_PATH, version: VERSION_NEUTRAL })
export class IngestController {
  /**
   * @param ingest - Where the contract is. Injected so a suite can drive the routes against a
   *   service that accepts, and one that refuses, without a database.
   */
  constructor(private readonly ingest: IngestService) {}

  /**
   * Open a run.
   *
   * @param principal - Who the guard proved the caller to be. The one place decision R4's
   *   watermark is decided.
   * @param request - The ticket, the repository, the pin, the model and the branch.
   * @returns The run, with the `loop_seq` the database allocated.
   */
  @Post()
  async openRun(
    @CallingPrincipal() principal: InternalPrincipal,
    @Body() request: OpenRunDto,
  ): Promise<RunOpenedResource> {
    return this.ingest.openRun(request, isSimulatedPrincipal(principal));
  }

  /**
   * Move one stage attempt.
   *
   * @param params - The run.
   * @param request - The stage, the status, and optionally the attempt, the instant and the
   *   loop edge it came back through. It carries no `note`: V045 composes that, and
   *   `ingest.dto.ts` is where the absence is argued.
   * @returns Where the stage stands afterwards.
   */
  @Post(STAGE_TRANSITIONS_ROUTE)
  @HttpCode(HttpStatus.OK)
  async transitionStage(
    @Param() params: RunIdParams,
    @Body() request: StageTransitionDto,
  ): Promise<StageTransitionResource> {
    return this.ingest.transitionStage(params.id, request);
  }

  /**
   * Append a batch to the transcript.
   *
   * @param params - The run.
   * @param request - The batch, in the executor's own order.
   * @returns The dense sequence numbers the store allocated, and whether a cap has elided it.
   */
  @Post(EVENTS_ROUTE)
  @HttpCode(HttpStatus.OK)
  async appendEvents(
    @Param() params: RunIdParams,
    @Body() request: IngestEventsDto,
  ): Promise<EventsAppendedResource> {
    return this.ingest.appendEvents(params.id, request);
  }

  /**
   * Report the change-set as it stands, and trigger the guardrails.
   *
   * @param params - The run.
   * @param request - The whole change-set, not the delta.
   * @returns The report's number, the totals, and how many checks it scheduled.
   */
  @Put(FILES_ROUTE)
  @HttpCode(HttpStatus.OK)
  async reportFiles(
    @Param() params: RunIdParams,
    @Body() request: ReportFilesDto,
  ): Promise<ChangeSetResource> {
    return this.ingest.reportFiles(params.id, request);
  }

  /**
   * Append commits.
   *
   * @param params - The run.
   * @param request - The commits, oldest first.
   * @returns How many were new and how many were already recorded.
   */
  @Post(COMMITS_ROUTE)
  @HttpCode(HttpStatus.OK)
  async reportCommits(
    @Param() params: RunIdParams,
    @Body() request: ReportCommitsDto,
  ): Promise<CommitsAppendedResource> {
    return this.ingest.reportCommits(params.id, request);
  }

  /**
   * Attribute spend, and take or release a build-farm reservation.
   *
   * @param params - The run.
   * @param request - The spend, the reservation, or both.
   * @returns What the run has spent in total, and what it now holds.
   */
  @Post(RESOURCES_ROUTE)
  @HttpCode(HttpStatus.OK)
  async reportResources(
    @Param() params: RunIdParams,
    @Body() request: ReportResourcesDto,
  ): Promise<ResourcesReportedResource> {
    return this.ingest.reportResources(params.id, request);
  }
}
