/**
 * `/api/v1/analyzer/suggestions/…` and `/api/v1/analyzer/batches/…` — the Build Analyzer's
 * suggestion actions (BV.5, [#514](https://github.com/NobuData/ouroboros/issues/514), mockup 18).
 *
 * **Who may do what.**
 *
 *   * **preview** — every member: it reads, and writes nothing.
 *   * **dismiss** — owner, admin or member (`CONTRIBUTORS`): declining an idea changes no plane.
 *   * **apply**, **draft** and **push** — owner or admin: each changes the farm, a workflow or the
 *     backlog through that plane's own API.
 *
 * Every action is audited with the suggestion, the actor and the payload. **The workspace is the
 * session's, never the request's.**
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../../auth/principal";
import type { Organization } from "../../db/schema";
import type { PushReport } from "../../planning/push.service";
import { ADMINISTRATORS, CONTRIBUTORS, Roles } from "../../tenancy/roles.guard";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import {
  ApplySuggestionBody,
  BatchIdParams,
  DismissSuggestionBody,
  DraftSuggestionsBody,
  SuggestionIdParams,
} from "./actions.dto";
import type {
  AppliedSuggestionResource,
  SuggestionPreviewResource,
  SuggestionResolutionResource,
} from "./actions.resources";
import { SuggestionActionsService, type DraftedBatch } from "./actions.service";

@Controller("analyzer")
export class SuggestionActionsController {
  /** @param actions - The actions. */
  constructor(private readonly actions: SuggestionActionsService) {}

  /**
   * `GET /api/v1/analyzer/suggestions/{id}/preview` — what Apply would change, and where.
   *
   * @param tenant - The workspace.
   * @param params - The suggestion.
   * @returns The preview.
   */
  @Get("suggestions/:id/preview")
  preview(
    @CurrentTenant() tenant: Organization,
    @Param() params: SuggestionIdParams,
  ): Promise<SuggestionPreviewResource> {
    return this.actions.preview(tenant.id, params.id);
  }

  /**
   * `POST /api/v1/analyzer/suggestions/{id}/apply`.
   *
   * @param tenant - The workspace.
   * @param principal - The administrator.
   * @param params - The suggestion.
   * @param body - `{fingerprint?}`.
   * @returns What was applied and where.
   */
  @Post("suggestions/:id/apply")
  @Roles(...ADMINISTRATORS)
  @HttpCode(HttpStatus.OK)
  apply(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: SuggestionIdParams,
    @Body() body: ApplySuggestionBody,
  ): Promise<AppliedSuggestionResource> {
    return this.actions.apply(tenant.id, principal.user.id, params.id, body.fingerprint);
  }

  /**
   * `POST /api/v1/analyzer/suggestions/{id}/dismiss`.
   *
   * @param tenant - The workspace.
   * @param principal - The member.
   * @param params - The suggestion.
   * @param body - `{reason?}`.
   * @returns The resolution.
   */
  @Post("suggestions/:id/dismiss")
  @Roles(...CONTRIBUTORS)
  @HttpCode(HttpStatus.OK)
  dismiss(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: SuggestionIdParams,
    @Body() body: DismissSuggestionBody,
  ): Promise<SuggestionResolutionResource> {
    return this.actions.dismiss(tenant.id, principal.user.id, params.id, body.reason);
  }

  /**
   * `POST /api/v1/analyzer/suggestions/draft` — ticket and spike suggestions into one batch.
   *
   * @param tenant - The workspace.
   * @param principal - The administrator.
   * @param body - `{suggestionIds, targetSourceId}`.
   * @returns `201` with the batch and the suggestions drafted into it.
   */
  @Post("suggestions/draft")
  @Roles(...ADMINISTRATORS)
  draft(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: DraftSuggestionsBody,
  ): Promise<DraftedBatch> {
    return this.actions.draft(
      tenant.id,
      principal.user.id,
      body.suggestionIds,
      body.targetSourceId,
    );
  }

  /**
   * `POST /api/v1/analyzer/batches/{id}/push` — push an analyzer-drafted batch's selected drafts.
   *
   * @param tenant - The workspace.
   * @param principal - The administrator.
   * @param params - The batch.
   * @returns The push report.
   */
  @Post("batches/:id/push")
  @Roles(...ADMINISTRATORS)
  @HttpCode(HttpStatus.OK)
  push(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: BatchIdParams,
  ): Promise<PushReport> {
    return this.actions.push(tenant.id, principal.user.id, params.id);
  }
}
