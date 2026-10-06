/**
 * `/api/v1/onboarding/detection` — the *"We already figured this out"* card's surface
 * ([#384](https://github.com/NobuData/ouroboros/issues/384), BB.1).
 *
 * ```
 * GET  /api/v1/onboarding/detection?repo=owner/name                   any member
 * GET  /api/v1/onboarding/detection/scans/{scanSeq}?repo=owner/name   any member
 * POST /api/v1/onboarding/detection/scan?repo=owner/name              contributors — 202, debounced
 * PUT  /api/v1/onboarding/detection/protected-paths?repo=owner/name   owner, admin — the list (#391)
 * ```
 *
 * The scan is asynchronous: `POST` answers `202` with the progress at once, and the card polls
 * `GET` — whose `progress` says how many probes have settled — until the new `scanSeq` appears.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";

import type { Organization } from "../db/schema";
import { ADMINISTRATORS, CONTRIBUTORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { DetectionRepoQuery, ProtectedPathsDto, ScanSeqParams } from "./detection.dto";
import type { DetectionResource, RescanResource } from "./detection.resources";
import { DetectionService } from "./detection.service";

@Controller("onboarding/detection")
export class DetectionController {
  constructor(private readonly detection: DetectionService) {}

  /**
   * The newest scan of a repository — the card.
   *
   * @param tenant - The workspace.
   * @param query - `?repo=owner/name`.
   * @returns The scan, its rows, the protected-path policies and the progress.
   */
  @Get()
  read(
    @CurrentTenant() tenant: Organization,
    @Query() query: DetectionRepoQuery,
  ): Promise<DetectionResource> {
    return this.detection.read(tenant.id, query.repo);
  }

  /**
   * One earlier scan, as it was stored.
   *
   * @param tenant - The workspace.
   * @param params - `{scanSeq}`.
   * @param query - `?repo=owner/name`.
   * @returns The scan; `404 detection_scan_not_found` when there is none.
   */
  @Get("scans/:scanSeq")
  readScan(
    @CurrentTenant() tenant: Organization,
    @Param() params: ScanSeqParams,
    @Query() query: DetectionRepoQuery,
  ): Promise<DetectionResource> {
    return this.detection.readScan(tenant.id, query.repo, params.scanSeq);
  }

  /**
   * Start a scan — or join the running one.
   *
   * @param tenant - The workspace.
   * @param query - `?repo=owner/name`.
   * @returns `202` with the progress; `409 detection_rescan_too_soon` inside the debounce window,
   *   `409 detection_source_missing` when nothing connected can probe the repository.
   */
  @Post("scan")
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(...CONTRIBUTORS)
  scan(
    @CurrentTenant() tenant: Organization,
    @Query() query: DetectionRepoQuery,
  ): Promise<RescanResource> {
    return this.detection.start(tenant.id, query.repo);
  }

  /**
   * Save the repository's protected-path list — the card's inline editor (#391). The globs are
   * what run guardrails refuse to let a loop touch, so this is **owner or admin**; the list
   * replaces what is stored, and no later scan suggests over it.
   *
   * @param tenant - The workspace.
   * @param query - `?repo=owner/name`.
   * @param body - The whole list.
   * @returns The card, with the list as stored; `422 detection_glob_invalid` naming refused globs.
   */
  @Put("protected-paths")
  @Roles(...ADMINISTRATORS)
  editProtectedPaths(
    @CurrentTenant() tenant: Organization,
    @Query() query: DetectionRepoQuery,
    @Body() body: ProtectedPathsDto,
  ): Promise<DetectionResource> {
    return this.detection.editProtectedPaths(tenant.id, query.repo, body.globs);
  }
}
