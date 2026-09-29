/**
 * `/api/v1/onboarding` — the wizard's orchestration surface
 * ([#385](https://github.com/NobuData/ouroboros/issues/385), BB.2).
 *
 * ```
 * GET   /api/v1/onboarding?repo=owner/name                 any member
 * PATCH /api/v1/onboarding?repo=owner/name                 picks: contributors; dismiss: any member
 * POST  /api/v1/onboarding/complete-step?repo=owner/name   contributors — guarded
 * POST  /api/v1/onboarding/skip?repo=owner/name            contributors — the import-skip
 * ```
 *
 * The repository is a query parameter on every route, so each repository's wizard is its own and
 * re-entering for a second repository is naming it. The `PATCH` role rule is the service's rather
 * than a `@Roles` decorator because it depends on the body: anyone may dismiss.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Query } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CONTRIBUTORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { CompleteStepDto, OnboardingRepoQuery, PatchOnboardingDto } from "./onboarding.dto";
import { OnboardingService } from "./onboarding.service";
import type { OnboardingResource, OnboardingSkipResource } from "./resources";

@Controller("onboarding")
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

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
}
