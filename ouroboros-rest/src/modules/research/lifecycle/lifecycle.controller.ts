/**
 * `/api/v1/research/investigations` — an investigation's lifecycle (CM.6,
 * [#625](https://github.com/NobuData/ouroboros/issues/625)):
 *
 *   POST …                          start: estimate check, then dispatch — `201`
 *   GET  …                          the card, History and the library: `kind`, `status` and
 *                                   `quarter` filters under the two computed counts
 *   GET  …/{investigationId}        one investigation, opened
 *   POST …/{investigationId}/cancel stop it; what it gathered is kept
 *   GET  …/{investigationId}/progress  its progress, as `text/event-stream`
 *
 * The workspace is the session's, and an investigation of another workspace is `404`. Every
 * member reads. **Starting follows the workspace's setting** (`/research/settings`), checked in
 * the service because it is data, not a fixed role list; **cancelling is the starter's or an
 * administrator's**. Both writes are a person's: a service account has nobody to start for.
 *
 * The brief itself is read at `…/{investigationId}/brief` (`briefs.controller.ts`).
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
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../../auth/principal";
import { HumanOnly } from "../../auth/service.scopes";
import type { SseResponse } from "../../copilot/copilot.stream";
import type { Organization } from "../../db/schema";
import { windowOf } from "../../tenancy/pagination";
import type { ActiveMembership } from "../../tenancy/tenant.context";
import { currentUser } from "../../tenancy/tenant.context";
import { CurrentMember, CurrentTenant } from "../../tenancy/tenant.decorators";
import { InvestigationParams } from "../briefs/briefs.dto";
import { ListInvestigationsQuery, StartInvestigationDto } from "./lifecycle.dto";
import type {
  CancelledInvestigationResource,
  InvestigationDetailResource,
  InvestigationListResource,
  StartedInvestigationResource,
} from "./lifecycle.resources";
import { InvestigationLifecycleService } from "./lifecycle.service";
import { watchProgress, writeProgress } from "./progress.stream";

/** A response a progress stream is written to, which says when its client has gone. */
export interface ProgressResponse extends SseResponse {
  /** Listen for the connection closing. */
  on(event: "close", listener: () => void): unknown;
}

@Controller("research/investigations")
export class InvestigationLifecycleController {
  /** @param lifecycle - Start, cancel, list, detail and progress. */
  constructor(private readonly lifecycle: InvestigationLifecycleService) {}

  /**
   * `POST …` — start an investigation.
   *
   * @param member - The workspace and the caller's roles.
   * @param principal - The session, for who is starting it.
   * @param body - The composer's payload.
   * @returns The investigation, dispatched, with its estimate.
   */
  @Post()
  @HumanOnly()
  start(
    @CurrentMember() member: ActiveMembership,
    @Session() principal: Principal,
    @Body() body: StartInvestigationDto,
  ): Promise<StartedInvestigationResource> {
    return this.lifecycle.start(
      member.tenant.id,
      { userId: principal.user.id, roles: member.roles },
      body,
    );
  }

  /**
   * `GET …` — the investigations list.
   *
   * @param tenant - The workspace.
   * @param query - Filters and the page.
   * @returns One page of rows, newest first, under `active` and `thisQuarter`.
   */
  @Get()
  list(
    @CurrentTenant() tenant: Organization,
    @Query() query: ListInvestigationsQuery,
  ): Promise<InvestigationListResource> {
    return this.lifecycle.list(tenant.id, query, windowOf(query));
  }

  /**
   * `GET …/{investigationId}` — one investigation, opened.
   *
   * @param member - The workspace and the caller's roles, for `mayCancel`.
   * @param params - The investigation.
   * @returns The detail.
   */
  @Get(":investigationId")
  detail(
    @CurrentMember() member: ActiveMembership,
    @Param() params: InvestigationParams,
  ): Promise<InvestigationDetailResource> {
    return this.lifecycle.detail(
      member.tenant.id,
      // A service account reads with no person behind it, so it never "started" anything.
      { userId: currentUser()?.id ?? null, roles: member.roles },
      params.investigationId,
    );
  }

  /**
   * `POST …/{investigationId}/cancel` — stop an investigation.
   *
   * @param member - The workspace and the caller's roles.
   * @param principal - The session, for who asked.
   * @param params - The investigation.
   * @returns `cancelled` or `cancelling`, and the investigation as it stands.
   */
  @Post(":investigationId/cancel")
  @HttpCode(HttpStatus.OK)
  @HumanOnly()
  cancel(
    @CurrentMember() member: ActiveMembership,
    @Session() principal: Principal,
    @Param() params: InvestigationParams,
  ): Promise<CancelledInvestigationResource> {
    return this.lifecycle.cancel(
      member.tenant.id,
      { userId: principal.user.id, roles: member.roles },
      params.investigationId,
    );
  }

  /**
   * `GET …/{investigationId}/progress` — the run's progress, live.
   *
   * @param tenant - The workspace.
   * @param params - The investigation.
   * @param response - Written directly, as a `text/event-stream`.
   * @returns When the stream has ended: the run finished, or the client went away.
   */
  @Get(":investigationId/progress")
  async progress(
    @CurrentTenant() tenant: Organization,
    @Param() params: InvestigationParams,
    @Res() response: ProgressResponse,
  ): Promise<void> {
    let closed = false;
    response.on("close", () => {
      closed = true;
    });

    await writeProgress(
      response,
      watchProgress(() => this.lifecycle.progress(tenant.id, params.investigationId), {
        closed: () => closed,
      }),
    );
  }
}
