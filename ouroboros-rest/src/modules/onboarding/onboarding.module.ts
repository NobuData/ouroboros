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
 * ```
 *
 * It reads four subsystems' tables directly rather than importing their modules: tenancy exports
 * nothing, and each question is one scoped query whose answer the owner's own rules already
 * guarantee. It writes `onboarding_state` only.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingRepository } from "./onboarding.repository";
import { OnboardingService } from "./onboarding.service";

@Module({
  imports: [DbModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, OnboardingRepository],
})
export class OnboardingModule {}
