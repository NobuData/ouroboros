/**
 * Onboarding — the Get Started wizard's orchestration API
 * ([#385](https://github.com/NobuData/ouroboros/issues/385), BB.2, decision **O1**).
 *
 * ```
 * controller   routes and request shape               → onboarding.controller.ts
 * service      the rules: compose, guard, skip        → onboarding.service.ts
 * derivation   subsystem facts → the rail (pure)      → onboarding.derivation.ts
 * surfacing    when /get-started is offered (pure)    → onboarding.surfacing.ts
 * repository   the statements                         → onboarding.repository.ts
 * templates    step 3's tiles and instantiation       → templates.service.ts (#386)
 * first issue  step 4's safe pick (scored, pure)      → first-issue.service.ts / .score.ts (#387)
 * ```
 *
 * It reads four subsystems' tables directly rather than importing their modules: tenancy exports
 * nothing, and each question is one scoped query whose answer the owner's own rules already
 * guarantee. It writes `onboarding_state` only — a workflow instantiated from a template is
 * written by `WorkflowsService`, imported from `WorkflowsModule`, so it passes the same publish
 * gate as the studio's (BB.3, #386).
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { BacklogHealthRepository } from "../planning/health.repository";
import { PoliciesModule } from "../policies/policies.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { FirstIssueRepository } from "./first-issue.repository";
import { FirstIssueService } from "./first-issue.service";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingRepository } from "./onboarding.repository";
import { OnboardingService } from "./onboarding.service";
import { TemplateTilesRepository } from "./templates.repository";
import { TemplateInstantiationService } from "./templates.service";

@Module({
  imports: [DbModule, WorkflowsModule, PoliciesModule],
  controllers: [OnboardingController],
  providers: [
    OnboardingService,
    OnboardingRepository,
    TemplateInstantiationService,
    TemplateTilesRepository,
    FirstIssueService,
    FirstIssueRepository,
    BacklogHealthRepository,
  ],
})
export class OnboardingModule {}
