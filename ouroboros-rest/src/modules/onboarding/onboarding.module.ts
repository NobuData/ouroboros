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
 * launch       run my first loop: guard, queue, receipt → launch.service.ts / .resources.ts (#388)
 * defaults     the deployment-aware right column     → defaults.service.ts / .resources.ts (#388)
 * ```
 *
 * It reads four subsystems' tables directly rather than importing their modules: tenancy exports
 * nothing, and each question is one scoped query whose answer the owner's own rules already
 * guarantee. It writes `onboarding_state` only — a workflow instantiated from a template is
 * written by `WorkflowsService`, imported from `WorkflowsModule`, so it passes the same publish
 * gate as the studio's (BB.3, #386). The launch's queue item is likewise written by
 * `BacklogQueueService`, imported from `BacklogModule`, so the sized-only rule and the workflow
 * pin stay M.3's and R.1's (BB.5, #388).
 */

import { Module } from "@nestjs/common";

import { BacklogModule } from "../backlog/backlog.module";
import { DbModule } from "../db/db.module";
import { BacklogHealthRepository } from "../planning/health.repository";
import { PoliciesModule } from "../policies/policies.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { FirstIssueRepository } from "./first-issue.repository";
import { FirstIssueService } from "./first-issue.service";
import { SmartDefaultsService } from "./defaults.service";
import { LaunchRepository } from "./launch.repository";
import { FirstRunLauncherService } from "./launch.service";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingRepository } from "./onboarding.repository";
import { OnboardingService } from "./onboarding.service";
import { TemplateTilesRepository } from "./templates.repository";
import { TemplateInstantiationService } from "./templates.service";

@Module({
  imports: [DbModule, WorkflowsModule, PoliciesModule, BacklogModule],
  controllers: [OnboardingController],
  providers: [
    OnboardingService,
    OnboardingRepository,
    TemplateInstantiationService,
    TemplateTilesRepository,
    FirstIssueService,
    FirstIssueRepository,
    BacklogHealthRepository,
    FirstRunLauncherService,
    LaunchRepository,
    SmartDefaultsService,
  ],
})
export class OnboardingModule {}
