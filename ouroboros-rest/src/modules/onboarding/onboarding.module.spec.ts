/** The onboarding module's wiring ([#385](https://github.com/NobuData/ouroboros/issues/385)). */

import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { BacklogHealthRepository } from "../planning/health.repository";
import { FirstIssueRepository } from "./first-issue.repository";
import { FirstIssueService } from "./first-issue.service";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingModule } from "./onboarding.module";
import { OnboardingRepository } from "./onboarding.repository";
import { OnboardingService } from "./onboarding.service";
import { TemplateTilesRepository } from "./templates.repository";
import { TemplateInstantiationService } from "./templates.service";

describe("the onboarding module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), OnboardingModule],
    }).compile();

    expect(moduleRef.get(OnboardingController)).toBeInstanceOf(OnboardingController);
    expect(moduleRef.get(OnboardingService)).toBeInstanceOf(OnboardingService);
    expect(moduleRef.get(OnboardingRepository)).toBeInstanceOf(OnboardingRepository);
    expect(moduleRef.get(TemplateInstantiationService)).toBeInstanceOf(
      TemplateInstantiationService,
    );
    expect(moduleRef.get(TemplateTilesRepository)).toBeInstanceOf(TemplateTilesRepository);
    expect(moduleRef.get(FirstIssueService)).toBeInstanceOf(FirstIssueService);
    expect(moduleRef.get(FirstIssueRepository)).toBeInstanceOf(FirstIssueRepository);
    expect(moduleRef.get(BacklogHealthRepository)).toBeInstanceOf(BacklogHealthRepository);

    await moduleRef.close();
  });

  it("exports nothing — the routes are the surface", () => {
    const exports = Reflect.getMetadata("exports", OnboardingModule) as unknown[] | undefined;

    expect(exports ?? []).toEqual([]);
  });
});
