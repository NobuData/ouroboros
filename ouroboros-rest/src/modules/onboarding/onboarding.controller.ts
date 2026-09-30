/**
 * `/api/v1/onboarding` — the wizard's orchestration surface
 * ([#385](https://github.com/NobuData/ouroboros/issues/385), BB.2).
 *
 * ```
 * GET   /api/v1/onboarding?repo=owner/name                 any member
 * PATCH /api/v1/onboarding?repo=owner/name                 picks: contributors; dismiss: any member
 * POST  /api/v1/onboarding/complete-step?repo=owner/name   contributors — guarded
 * POST  /api/v1/onboarding/skip?repo=owner/name            contributors — the import-skip
 * GET   /api/v1/onboarding/templates?repo=owner/name       any member — step 3's tiles (#386)
 * POST  /api/v1/onboarding/select-template?repo=owner/name administrators — instantiate (#386)
 * GET   /api/v1/onboarding/first-issue?repo=owner/name     any member — step 4's safe pick (#387)
 * GET   /api/v1/onboarding/first-issue/alternatives?repo=  any member — "or pick your own" (#387)
 * ```
 *
 * `select-template` publishes a workflow, so it carries the studio's publish rule —
 * `@Roles(...ADMINISTRATORS)` — rather than the contributor rule a pick carries: the wizard is
 * not a way round who may publish.
 *
 * The repository is a query parameter on every route, so each repository's wizard is its own and
 * re-entering for a second repository is naming it. The `PATCH` role rule is the service's rather
 * than a `@Roles` decorator because it depends on the body: anyone may dismiss.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Query } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, CONTRIBUTORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import {
  CompleteStepDto,
  FirstIssueAlternativesQuery,
  OnboardingRepoQuery,
  PatchOnboardingDto,
  SelectTemplateDto,
} from "./onboarding.dto";
import type { FirstIssueAlternativesResource, FirstIssueResource } from "./first-issue.resources";
import { FirstIssueService } from "./first-issue.service";
import { OnboardingService } from "./onboarding.service";
import type { OnboardingResource, OnboardingSkipResource } from "./resources";
import type { TemplateSelectionResource, TemplateTilesResource } from "./templates.resources";
import { TemplateInstantiationService } from "./templates.service";

@Controller("onboarding")
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly templates: TemplateInstantiationService,
    private readonly picker: FirstIssueService,
  ) {}

  /**
   * The wizard for one repository.
   *
   * @param tenant - The workspace.
   * @param query - `?repo=owner/name`.
   * @returns Derived steps, stored choices, card references and the surfacing decision.
   */
  @Get()
  read(
    @CurrentTenant() tenant: Organization,
    @Query() query: OnboardingRepoQuery,
  ): Promise<OnboardingResource> {
    return this.onboarding.read(tenant.id, query.repo);
  }

  /**
   * Change the wizard's choices — template pick, issue pick, dismissal.
   *
   * @param tenant - The workspace.
   * @param query - `?repo=owner/name`.
   * @param patch - What changed.
   * @returns The whole surface after the write.
   */
  @Patch()
  update(
    @CurrentTenant() tenant: Organization,
    @Query() query: OnboardingRepoQuery,
    @Body() patch: PatchOnboardingDto,
  ): Promise<OnboardingResource> {
    return this.onboarding.update(tenant.id, query.repo, patch);
  }

  /**
   * Complete a step, guarded by the derived rail.
   *
   * @param tenant - The workspace.
   * @param query - `?repo=owner/name`.
   * @param body - The step.
   * @returns The surface; `409 onboarding_step_incomplete` with a stated reason when refused.
   */
  @Post("complete-step")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  completeStep(
    @CurrentTenant() tenant: Organization,
    @Query() query: OnboardingRepoQuery,
    @Body() body: CompleteStepDto,
  ): Promise<OnboardingResource> {
    return this.onboarding.completeStep(tenant.id, query.repo, body.step);
  }

  /**
   * The import-skip — "I've done this before — import config".
   *
   * @param tenant - The workspace.
   * @param query - `?repo=owner/name`.
   * @returns The surface, the settings pointer and `configurationImported: false`.
   */
  @Post("skip")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  skip(
    @CurrentTenant() tenant: Organization,
    @Query() query: OnboardingRepoQuery,
  ): Promise<OnboardingSkipResource> {
    return this.onboarding.skip(tenant.id, query.repo);
  }

  /**
   * Step 3's template tiles, each with its evaluated unlock gate (BB.3, #386).
   *
   * @param tenant - The workspace.
   * @param query - `?repo=owner/name` — which repository's active choice to mark.
   * @returns The tiles.
   */
  @Get("templates")
  listTemplates(
    @CurrentTenant() tenant: Organization,
    @Query() query: OnboardingRepoQuery,
  ): Promise<TemplateTilesResource> {
    return this.templates.list(tenant.id, query.repo);
  }

  /**
   * Select a template: instantiate it as a published workflow (or reuse its live one) and make
   * it the repository's active choice (BB.3, #386).
   *
   * @param tenant - The workspace.
   * @param query - `?repo=owner/name`.
   * @param principal - The session — v1's publisher.
   * @param body - The template's slug.
   * @returns The workflow, the workflows kept, and the wizard.
   */
  @Post("select-template")
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMINISTRATORS)
  selectTemplate(
    @CurrentTenant() tenant: Organization,
    @Query() query: OnboardingRepoQuery,
    @Session() principal: Principal,
    @Body() body: SelectTemplateDto,
  ): Promise<TemplateSelectionResource> {
    return this.templates.select(tenant.id, query.repo, body.slug, principal.user.id);
  }

  /**
   * Step 4's safe first issue — a deterministic, explained pick over the sized backlog (BB.4,
   * #387).
   *
   * @param tenant - The workspace.
   * @param query - `?repo=owner/name`.
   * @returns The state (`picked`, `sizing`, `empty`, `none_safe`), the pick and its reasoning.
   */
  @Get("first-issue")
  firstIssue(
    @CurrentTenant() tenant: Organization,
    @Query() query: OnboardingRepoQuery,
  ): Promise<FirstIssueResource> {
    return this.picker.pick(tenant.id, query.repo);
  }

  /**
   * *Or pick your own* — the backlog's qualifying candidates, safest first, each with its own
   * reasoning (BB.4, #387).
   *
   * @param tenant - The workspace.
   * @param query - `?repo=owner/name&limit=10`.
   * @returns The ranked candidates.
   */
  @Get("first-issue/alternatives")
  firstIssueAlternatives(
    @CurrentTenant() tenant: Organization,
    @Query() query: FirstIssueAlternativesQuery,
  ): Promise<FirstIssueAlternativesResource> {
    return this.picker.alternatives(tenant.id, query.repo, query.limit);
  }
}
