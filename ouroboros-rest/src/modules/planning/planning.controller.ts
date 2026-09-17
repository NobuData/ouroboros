/**
 * `/api/v1/planning` — the Roadmap card's lanes, the Backlog Health card, and the milestone
 * passthrough.
 *
 * AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280)). Reads are open to every member;
 * **every epic mutation is administrators only** — a lane is shared planning intent, and changing it
 * is the same kind of act as pushing, which the generator card also reserves for administrators.
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
  Put,
} from "@nestjs/common";

import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { BatchesService } from "./batches.service";
import { EpicsService } from "./epics.service";
import { BacklogHealthService } from "./health.service";
import {
  CreateEpicBody,
  EpicParams,
  EpicTicketsBody,
  PlanningSourceParams,
  ReorderEpicsBody,
  UpdateEpicBody,
} from "./planning.dto";
import type {
  BacklogHealthResource,
  EpicResource,
  MilestonesResource,
  RoadmapResource,
} from "./planning.resources";

@Controller("planning")
export class PlanningController {
  /**
   * @param epics - The lanes.
   * @param batches - The generator card's service, for the milestone passthrough.
   * @param health - The Backlog Health card (AL.5, #281).
   */
  constructor(
    private readonly epics: EpicsService,
    private readonly batches: BatchesService,
    private readonly health: BacklogHealthService,
  ) {}

  /**
   * The Backlog Health card — sized, blocked and stale meters with drill-through filters, and the
   * nightly re-estimation job's schedule and last run. Any member.
   *
   * @param tenant - The workspace.
   * @returns The card.
   */
  @Get("health")
  backlogHealth(@CurrentTenant() tenant: Organization): Promise<BacklogHealthResource> {
    return this.health.health(tenant.id);
  }

  /**
   * The roadmap payload — lanes with computed chips.
   *
   * @param tenant - The workspace.
   * @returns The roadmap.
   */
  @Get("roadmap")
  roadmap(@CurrentTenant() tenant: Organization): Promise<RoadmapResource> {
    return this.epics.roadmap(tenant.id);
  }

  /**
   * Every lane, top first.
   *
   * @param tenant - The workspace.
   * @returns The lanes.
   */
  @Get("epics")
  list(@CurrentTenant() tenant: Organization): Promise<EpicResource[]> {
    return this.epics.list(tenant.id);
  }

  /**
   * Create a lane.
   *
   * @param tenant - The workspace.
   * @param body - Its fields.
   * @returns The lane. `201`.
   */
  @Post("epics")
  @Roles(...ADMINISTRATORS)
  create(
    @CurrentTenant() tenant: Organization,
    @Body() body: CreateEpicBody,
  ): Promise<EpicResource> {
    return this.epics.create(tenant.id, body);
  }

  /**
   * Put the lanes in order.
   *
   * @param tenant - The workspace.
   * @param body - Every lane, top first.
   * @returns The lanes in their new order.
   */
  @Put("epics/order")
  @Roles(...ADMINISTRATORS)
  reorder(
    @CurrentTenant() tenant: Organization,
    @Body() body: ReorderEpicsBody,
  ): Promise<EpicResource[]> {
    return this.epics.reorder(tenant.id, body.epicIds);
  }

  /**
   * One lane.
   *
   * @param tenant - The workspace.
   * @param params - The epic.
   * @returns The lane.
   */
  @Get("epics/:epic")
  read(@CurrentTenant() tenant: Organization, @Param() params: EpicParams): Promise<EpicResource> {
    return this.epics.read(tenant.id, params.epic);
  }

  /**
   * Edit a lane.
   *
   * @param tenant - The workspace.
   * @param params - The epic.
   * @param body - What changes.
   * @returns The lane.
   */
  @Patch("epics/:epic")
  @Roles(...ADMINISTRATORS)
  update(
    @CurrentTenant() tenant: Organization,
    @Param() params: EpicParams,
    @Body() body: UpdateEpicBody,
  ): Promise<EpicResource> {
    return this.epics.update(tenant.id, params.epic, body);
  }

  /**
   * Delete a lane.
   *
   * @param tenant - The workspace.
   * @param params - The epic.
   */
  @Delete("epics/:epic")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...ADMINISTRATORS)
  remove(@CurrentTenant() tenant: Organization, @Param() params: EpicParams): Promise<void> {
    return this.epics.remove(tenant.id, params.epic);
  }

  /**
   * Link tickets to a lane.
   *
   * @param tenant - The workspace.
   * @param params - The epic.
   * @param body - The tickets.
   * @returns The lane.
   */
  @Post("epics/:epic/tickets")
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMINISTRATORS)
  link(
    @CurrentTenant() tenant: Organization,
    @Param() params: EpicParams,
    @Body() body: EpicTicketsBody,
  ): Promise<EpicResource> {
    return this.epics.link(tenant.id, params.epic, body.ticketIds);
  }

  /**
   * Unlink tickets from a lane.
   *
   * @param tenant - The workspace.
   * @param params - The epic.
   * @param body - The tickets.
   * @returns The lane.
   */
  @Delete("epics/:epic/tickets")
  @Roles(...ADMINISTRATORS)
  unlink(
    @CurrentTenant() tenant: Organization,
    @Param() params: EpicParams,
    @Body() body: EpicTicketsBody,
  ): Promise<EpicResource> {
    return this.epics.unlink(tenant.id, params.epic, body.ticketIds);
  }

  /**
   * A source's milestones — the **Milestone ▾** options, passed through from the tracker.
   *
   * @param tenant - The workspace.
   * @param params - The source.
   * @returns The milestones.
   */
  @Get("sources/:source/milestones")
  milestones(
    @CurrentTenant() tenant: Organization,
    @Param() params: PlanningSourceParams,
  ): Promise<MilestonesResource> {
    return this.batches.milestones(tenant.id, params.source);
  }
}
