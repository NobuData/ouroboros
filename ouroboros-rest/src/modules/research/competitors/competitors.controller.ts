/**
 * `/api/v1/research/competitors` — the competitor tracker's registry, and
 * `/api/v1/research/competitor-changes` — its change feed (CL.3,
 * [#616](https://github.com/NobuData/ouroboros/issues/616)).
 *
 * Every member reads; owners and admins write. The workspace is the session's.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";

import type { Organization } from "../../db/schema";
import { ADMINISTRATORS, Roles } from "../../tenancy/roles.guard";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import {
  ChangeFeedQuery,
  CompetitorParams,
  CreateCompetitorDto,
  CreateWatchDto,
  UpdateCompetitorDto,
  UpdateWatchDto,
  WatchParams,
} from "./competitors.dto";
import type {
  CompetitorChangeFeedResource,
  CompetitorListResource,
  CompetitorResource,
  CompetitorWatchResource,
} from "./competitors.resources";
import { CompetitorsService } from "./competitors.service";

@Controller("research")
export class CompetitorsController {
  /** @param competitors - The registry. */
  constructor(private readonly competitors: CompetitorsService) {}

  /**
   * `GET /research/competitors` — the rivals, their watches and the tracker's sub-line.
   *
   * @param tenant - The workspace.
   * @returns The registry.
   */
  @Get("competitors")
  list(@CurrentTenant() tenant: Organization): Promise<CompetitorListResource> {
    return this.competitors.list(tenant.id);
  }

  /**
   * `POST /research/competitors` — add a rival.
   *
   * @param tenant - The workspace.
   * @param body - Name, site, aliases, notes.
   * @returns The rival.
   */
  @Post("competitors")
  @Roles(...ADMINISTRATORS)
  create(
    @CurrentTenant() tenant: Organization,
    @Body() body: CreateCompetitorDto,
  ): Promise<CompetitorResource> {
    return this.competitors.create(tenant.id, body);
  }

  /**
   * `PATCH /research/competitors/{competitorId}` — edit a rival.
   *
   * @param tenant - The workspace.
   * @param params - The rival.
   * @param body - What to change.
   * @returns The rival after the change.
   */
  @Patch("competitors/:competitorId")
  @Roles(...ADMINISTRATORS)
  update(
    @CurrentTenant() tenant: Organization,
    @Param() params: CompetitorParams,
    @Body() body: UpdateCompetitorDto,
  ): Promise<CompetitorResource> {
    return this.competitors.update(tenant.id, params.competitorId, body);
  }

  /**
   * `DELETE /research/competitors/{competitorId}` — remove a rival and its watches.
   *
   * @param tenant - The workspace.
   * @param params - The rival.
   * @returns Nothing (`204`).
   */
  @Delete("competitors/:competitorId")
  @Roles(...ADMINISTRATORS)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentTenant() tenant: Organization, @Param() params: CompetitorParams): Promise<void> {
    return this.competitors.remove(tenant.id, params.competitorId);
  }

  /**
   * `POST /research/competitors/{competitorId}/watches` — watch a source of a rival.
   *
   * @param tenant - The workspace.
   * @param params - The rival.
   * @param body - Kind, URL, selector, cadence.
   * @returns The watch.
   */
  @Post("competitors/:competitorId/watches")
  @Roles(...ADMINISTRATORS)
  addWatch(
    @CurrentTenant() tenant: Organization,
    @Param() params: CompetitorParams,
    @Body() body: CreateWatchDto,
  ): Promise<CompetitorWatchResource> {
    return this.competitors.addWatch(tenant.id, params.competitorId, body);
  }

  /**
   * `PATCH /research/competitors/{competitorId}/watches/{watchId}` — change a watch's schedule.
   *
   * @param tenant - The workspace.
   * @param params - The rival and the watch.
   * @param body - Cadence, enabled, renderRequired.
   * @returns The watch after the change.
   */
  @Patch("competitors/:competitorId/watches/:watchId")
  @Roles(...ADMINISTRATORS)
  updateWatch(
    @CurrentTenant() tenant: Organization,
    @Param() params: WatchParams,
    @Body() body: UpdateWatchDto,
  ): Promise<CompetitorWatchResource> {
    return this.competitors.updateWatch(tenant.id, params.competitorId, params.watchId, body);
  }

  /**
   * `DELETE /research/competitors/{competitorId}/watches/{watchId}` — stop watching a source.
   *
   * @param tenant - The workspace.
   * @param params - The rival and the watch.
   * @returns Nothing (`204`).
   */
  @Delete("competitors/:competitorId/watches/:watchId")
  @Roles(...ADMINISTRATORS)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeWatch(@CurrentTenant() tenant: Organization, @Param() params: WatchParams): Promise<void> {
    return this.competitors.removeWatch(tenant.id, params.competitorId, params.watchId);
  }

  /**
   * `GET /research/competitor-changes` — the archived changes, newest first.
   *
   * @param tenant - The workspace.
   * @param query - Rival, kind, since, before, limit.
   * @returns One page of changes.
   */
  @Get("competitor-changes")
  feed(
    @CurrentTenant() tenant: Organization,
    @Query() query: ChangeFeedQuery,
  ): Promise<CompetitorChangeFeedResource> {
    return this.competitors.feed(tenant.id, query);
  }
}
