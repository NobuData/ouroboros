/**
 * The two paths from a brief to work, over HTTP (CM.5,
 * [#624](https://github.com/NobuData/ouroboros/issues/624)):
 *
 * ```
 * POST /api/v1/research/investigations/:investigationId/draft-epic
 *
 * POST /api/v1/research/investigations/:investigationId/roadmap                    generate v1
 * GET  /api/v1/research/investigations/:investigationId/roadmap                    the card
 * POST /api/v1/research/investigations/:investigationId/roadmap/suggestions
 * POST …/roadmap/suggestions/:suggestionId/apply                                    re-run → vN+1
 * POST …/roadmap/suggestions/:suggestionId/dismiss
 * POST …/roadmap/issues                                                             create-issues
 * POST …/roadmap/drift-check
 *
 * GET  /api/v1/research/roadmap-settings
 * PUT  /api/v1/research/roadmap-settings
 * ```
 *
 * **Who may do what** follows Planning: drafting is a contributor's (the gaps hand-off, a
 * suggestion, a drift check); anything that writes to the repository or the tracker — generating,
 * applying, filing — and dismissing or changing the policy is an owner's or admin's. Every member
 * reads. Every write needs a person: a service account cannot start a re-run or a push.
 *
 * The issue wrote these as `/research/:id/…`; they sit under `/research/investigations/:id/…`
 * with the rest of an investigation's routes (#625).
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../../auth/principal";
import { HumanOnly } from "../../auth/service.scopes";
import type { Organization } from "../../db/schema";
import { ADMINISTRATORS, CONTRIBUTORS, Roles } from "../../tenancy/roles.guard";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import { GapHandoffService } from "./gap-handoff.service";
import {
  DraftEpicDto,
  FileIssuesDto,
  GenerateRoadmapDto,
  RoadmapParams,
  SaveRoadmapSettingsDto,
  SuggestDto,
  SuggestionParams,
} from "./pipeline.dto";
import type {
  DraftEpicResource,
  DriftResource,
  IssuesResource,
  PipelineSettingsResource,
  RoadmapResource,
  SuggestionResource,
} from "./pipeline.resources";
import { RoadmapDriftService } from "./roadmap.drift.service";
import { RoadmapIssuesService } from "./roadmap.issues.service";
import { RoadmapService } from "./roadmap.service";

@Controller("research")
export class PipelineController {
  /**
   * @param gaps - The gaps hand-off.
   * @param roadmap - The document, its suggestions and the policy.
   * @param issues - `create-issues` and the writeback.
   * @param drift - The drift check.
   */
  constructor(
    private readonly gaps: GapHandoffService,
    private readonly roadmap: RoadmapService,
    private readonly issues: RoadmapIssuesService,
    private readonly drift: RoadmapDriftService,
  ) {}

  /**
   * `POST …/draft-epic` — **Draft epic from gaps →**. Nothing is filed.
   *
   * @param tenant - The workspace.
   * @param principal - The session, for who drafted it.
   * @param params - The investigation.
   * @param body - The tracker the drafts are for.
   * @returns The epic, the batch and where to review it.
   */
  @Post("investigations/:investigationId/draft-epic")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  @HumanOnly()
  draftEpic(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: RoadmapParams,
    @Body() body: DraftEpicDto,
  ): Promise<DraftEpicResource> {
    return this.gaps.draftEpic(
      tenant.id,
      principal.user.id,
      params.investigationId,
      body.targetSourceId,
    );
  }

  /**
   * `POST …/roadmap` — generate the roadmap from the brief: version 1, then a pull request.
   *
   * @param tenant - The workspace.
   * @param params - The investigation.
   * @param body - Where it goes.
   * @returns The card.
   */
  @Post("investigations/:investigationId/roadmap")
  @Roles(...ADMINISTRATORS)
  @HumanOnly()
  generate(
    @CurrentTenant() tenant: Organization,
    @Param() params: RoadmapParams,
    @Body() body: GenerateRoadmapDto,
  ): Promise<RoadmapResource> {
    return this.roadmap.generate(tenant.id, params.investigationId, {
      ...(body.targetSourceId === undefined ? {} : { targetSourceId: body.targetSourceId }),
      ...(body.path === undefined ? {} : { path: body.path }),
    });
  }

  /**
   * `GET …/roadmap` — the pipeline card.
   *
   * @param tenant - The workspace.
   * @param params - The investigation.
   * @returns The document, its projection, milestones, issues and suggestions.
   */
  @Get("investigations/:investigationId/roadmap")
  card(
    @CurrentTenant() tenant: Organization,
    @Param() params: RoadmapParams,
  ): Promise<RoadmapResource> {
    return this.roadmap.card(tenant.id, params.investigationId);
  }

  /**
   * `POST …/roadmap/suggestions` — suggest a change.
   *
   * @param tenant - The workspace.
   * @param principal - The session, for who suggests it.
   * @param params - The investigation.
   * @param body - The text and an optional hint.
   * @returns The suggestion, open.
   */
  @Post("investigations/:investigationId/roadmap/suggestions")
  @Roles(...CONTRIBUTORS)
  @HumanOnly()
  suggest(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: RoadmapParams,
    @Body() body: SuggestDto,
  ): Promise<SuggestionResource> {
    return this.roadmap.suggest(tenant.id, principal.user.id, params.investigationId, {
      text: body.text,
      hint: body.hint ?? null,
    });
  }

  /**
   * `POST …/apply` — **Apply ⟳**: re-run `create-roadmap` with the suggestion appended.
   *
   * @param tenant - The workspace.
   * @param principal - The session, for who applied it.
   * @param params - The investigation and the suggestion.
   * @returns The card, on the new version.
   */
  @Post("investigations/:investigationId/roadmap/suggestions/:suggestionId/apply")
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMINISTRATORS)
  @HumanOnly()
  apply(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: SuggestionParams,
  ): Promise<RoadmapResource> {
    return this.roadmap.apply(
      tenant.id,
      principal.user.id,
      params.investigationId,
      params.suggestionId,
    );
  }

  /**
   * `POST …/dismiss` — **Dismiss**. Audited.
   *
   * @param tenant - The workspace.
   * @param principal - The session, for who dismissed it.
   * @param params - The investigation and the suggestion.
   * @returns The card.
   */
  @Post("investigations/:investigationId/roadmap/suggestions/:suggestionId/dismiss")
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMINISTRATORS)
  @HumanOnly()
  dismiss(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: SuggestionParams,
  ): Promise<RoadmapResource> {
    return this.roadmap.dismiss(
      tenant.id,
      principal.user.id,
      params.investigationId,
      params.suggestionId,
    );
  }

  /**
   * `POST …/roadmap/issues` — `create-issues`: draft, size, push and write back, as far as can
   * be done now. Call again while it answers `sizing` or `partial`.
   *
   * @param tenant - The workspace.
   * @param principal - The session, for who asked.
   * @param params - The investigation.
   * @param body - Whether to push unsized drafts.
   * @returns Where it stopped, and the card.
   */
  @Post("investigations/:investigationId/roadmap/issues")
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMINISTRATORS)
  @HumanOnly()
  file(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: RoadmapParams,
    @Body() body: FileIssuesDto,
  ): Promise<IssuesResource> {
    return this.issues.file(tenant.id, principal.user.id, params.investigationId, {
      ...(body.pushUnsized === undefined ? {} : { pushUnsized: body.pushUnsized }),
    });
  }

  /**
   * `POST …/roadmap/drift-check` — compare the document with the tracker and the repository.
   *
   * @param tenant - The workspace.
   * @param params - The investigation.
   * @returns Whether they agree, what differs, and the suggestion raised.
   */
  @Post("investigations/:investigationId/roadmap/drift-check")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  @HumanOnly()
  check(
    @CurrentTenant() tenant: Organization,
    @Param() params: RoadmapParams,
  ): Promise<DriftResource> {
    return this.drift.check(tenant.id, params.investigationId);
  }

  /**
   * `GET /research/roadmap-settings` — the pipeline policy.
   *
   * @param tenant - The workspace.
   * @returns Whether direct commit is on.
   */
  @Get("roadmap-settings")
  settings(@CurrentTenant() tenant: Organization): Promise<PipelineSettingsResource> {
    return this.roadmap.settings(tenant.id);
  }

  /**
   * `PUT /research/roadmap-settings` — change the policy. Audited.
   *
   * @param tenant - The workspace.
   * @param principal - The session, for who decided.
   * @param body - The policy.
   * @returns The policy as it now stands.
   */
  @Put("roadmap-settings")
  @Roles(...ADMINISTRATORS)
  @HumanOnly()
  saveSettings(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: SaveRoadmapSettingsDto,
  ): Promise<PipelineSettingsResource> {
    return this.roadmap.saveSettings(tenant.id, principal.user.id, body.directCommit);
  }
}
