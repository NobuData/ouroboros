/**
 * `/api/v1/workflows/{id}/dry-runs…` — the deep dry run's routes (CD.4,
 * [#562](https://github.com/NobuData/ouroboros/issues/562)).
 *
 * ```
 * POST   …/dry-runs                         start one against a ticket          contributors
 * GET    …/dry-runs                         the history line and its runs       every member
 * GET    …/dry-runs/candidates              the edge-case picker (W8)           every member
 * GET    …/dry-runs/safety                  the safety strip, as data           every member
 * GET    …/dry-runs/{dryRunId}              one dry run, whole                  every member
 * GET    …/dry-runs/{dryRunId}/events       its progress, text/event-stream     every member
 * POST   …/dry-runs/{dryRunId}/cancel       stop it; rows so far are kept       contributors
 * POST   …/dry-runs/{dryRunId}/rerun        again, on the draft as it is now    contributors
 * ```
 *
 * **Starting, cancelling and re-running are contributors'** — owner, admin and member. A dry
 * run changes no draft, so it is not an administrator's the way the copilot's own routes are;
 * but it spends the workspace's money on real models, which is exactly what `CONTRIBUTORS`
 * exists to draw the line at, and a viewer may not. **The reads are every member's**, like the
 * draft a viewer may already read.
 *
 * The two literal segments are declared before `:dryRunId`, so `candidates` and `safety` are
 * never read as a dry run's id.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";

import type { SseResponse } from "../copilot/copilot.stream";
import type { Organization } from "../db/schema";
import { CONTRIBUTORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import {
  DryRunCandidatesQuery,
  DryRunParams,
  DryRunWorkflowParams,
  StartDryRunBody,
} from "./dry-runs.dto";
import type {
  DryRunCandidatesResource,
  DryRunHistoryResource,
  DryRunResource,
} from "./dry-runs.resources";
import type { DryRunSafetyResource } from "./dry-runs.safety";
import { DryRunsService } from "./dry-runs.service";
import { writeDryRunEvents } from "./dry-runs.stream";

/** The response the events route writes to: a stream that says when its client has gone. */
export interface DryRunEventsResponse extends SseResponse {
  /** Subscribe to the connection closing. */
  on(event: "close", listener: () => void): unknown;
}

@Controller("workflows/:id/dry-runs")
export class DryRunsController {
  /** @param dryRuns - The lifecycle. */
  constructor(private readonly dryRuns: DryRunsService) {}

  /**
   * `POST /api/v1/workflows/{id}/dry-runs` — start a dry run of the draft against a ticket.
   *
   * Answers as soon as the run is dispatched; follow it on `…/{dryRunId}/events`. A draft that
   * fails the structural pre-check answers `201` too, with a dry run that is already `failed`
   * and carries the anchored findings — a pre-check is recorded, and nothing was invoked.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The workflow's id.
   * @param body - The ticket, the draft revision and, optionally, the copilot session.
   * @returns The dry run, `201`.
   */
  @Roles(...CONTRIBUTORS)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  start(
    @CurrentTenant() tenant: Organization,
    @Param() params: DryRunWorkflowParams,
    @Body() body: StartDryRunBody,
  ): Promise<DryRunResource> {
    return this.dryRuns.start(tenant.id, params.id, body);
  }

  /**
   * `GET /api/v1/workflows/{id}/dry-runs` — the footer's `history: N dry runs · draft v0.3`.
   *
   * @param tenant - The workspace.
   * @param params - The workflow's id.
   * @returns The count, the workflow's dry-run spend, and the runs newest first.
   */
  @Get()
  history(
    @CurrentTenant() tenant: Organization,
    @Param() params: DryRunWorkflowParams,
  ): Promise<DryRunHistoryResource> {
    return this.dryRuns.history(tenant.id, params.id);
  }

  /**
   * `GET /api/v1/workflows/{id}/dry-runs/candidates` — the tickets most worth dry-running the
   * draft against, the most mismatched first, each with its reason (decision W8).
   *
   * @param tenant - The workspace.
   * @param params - The workflow's id.
   * @param query - How many.
   * @returns The ranked candidates.
   */
  @Get("candidates")
  candidates(
    @CurrentTenant() tenant: Organization,
    @Param() params: DryRunWorkflowParams,
    @Query() query: DryRunCandidatesQuery,
  ): Promise<DryRunCandidatesResource> {
    return this.dryRuns.candidates(tenant.id, params.id, query.limit);
  }

  /**
   * `GET /api/v1/workflows/{id}/dry-runs/safety` — the safety strip's three columns, each with
   * the mechanism that backs it, derived from the harness's configuration.
   *
   * @param tenant - The workspace.
   * @param params - The workflow's id.
   * @returns The strip.
   */
  @Get("safety")
  safety(
    @CurrentTenant() tenant: Organization,
    @Param() params: DryRunWorkflowParams,
  ): Promise<DryRunSafetyResource> {
    return this.dryRuns.safety(tenant.id, params.id);
  }

  /**
   * `GET /api/v1/workflows/{id}/dry-runs/{dryRunId}` — one dry run, with its rows, artifacts,
   * totals and guard audit.
   *
   * @param tenant - The workspace.
   * @param params - The workflow and the dry run.
   * @returns The dry run.
   */
  @Get(":dryRunId")
  detail(
    @CurrentTenant() tenant: Organization,
    @Param() params: DryRunParams,
  ): Promise<DryRunResource> {
    return this.dryRuns.detail(tenant.id, params.id, params.dryRunId);
  }

  /**
   * `GET /api/v1/workflows/{id}/dry-runs/{dryRunId}/events` — the dry run's progress, live.
   *
   * @param tenant - The workspace.
   * @param params - The workflow and the dry run.
   * @param response - Written directly, as a `text/event-stream`.
   * @returns When the stream has ended: the run finished, or the client went away.
   */
  @Get(":dryRunId/events")
  async events(
    @CurrentTenant() tenant: Organization,
    @Param() params: DryRunParams,
    @Res() response: DryRunEventsResponse,
  ): Promise<void> {
    const gone = new AbortController();
    response.on("close", () => {
      gone.abort();
    });

    await writeDryRunEvents(
      response,
      this.dryRuns.events(tenant.id, params.id, params.dryRunId, gone.signal),
    );
  }

  /**
   * `POST /api/v1/workflows/{id}/dry-runs/{dryRunId}/cancel` — stop a running dry run. The rows
   * it reached are kept and it ends `cancelled`.
   *
   * @param tenant - The workspace.
   * @param params - The workflow and the dry run.
   * @returns The dry run as it ended, `200`.
   */
  @Roles(...CONTRIBUTORS)
  @Post(":dryRunId/cancel")
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentTenant() tenant: Organization,
    @Param() params: DryRunParams,
  ): Promise<DryRunResource> {
    return this.dryRuns.cancel(tenant.id, params.id, params.dryRunId);
  }

  /**
   * `POST /api/v1/workflows/{id}/dry-runs/{dryRunId}/rerun` — run it again against the same
   * ticket, on the draft **as it is now**.
   *
   * @param tenant - The workspace.
   * @param params - The workflow and the dry run to repeat.
   * @returns The new dry run, `201`.
   */
  @Roles(...CONTRIBUTORS)
  @Post(":dryRunId/rerun")
  @HttpCode(HttpStatus.CREATED)
  rerun(
    @CurrentTenant() tenant: Organization,
    @Param() params: DryRunParams,
  ): Promise<DryRunResource> {
    return this.dryRuns.rerun(tenant.id, params.id, params.dryRunId);
  }
}
