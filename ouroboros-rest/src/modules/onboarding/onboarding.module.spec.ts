/** The onboarding module's wiring ([#385](https://github.com/NobuData/ouroboros/issues/385)). */

import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingModule } from "./onboarding.module";
import { OnboardingRepository } from "./onboarding.repository";
import { OnboardingService } from "./onboarding.service";

describe("the onboarding module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), OnboardingModule],
    }).compile();

    expect(moduleRef.get(OnboardingController)).toBeInstanceOf(OnboardingController);
    expect(moduleRef.get(OnboardingService)).toBeInstanceOf(OnboardingService);
    expect(moduleRef.get(OnboardingRepository)).toBeInstanceOf(OnboardingRepository);

    await moduleRef.close();
  });

  it("exports nothing — the routes are the surface", () => {
    const exports = Reflect.getMetadata("exports", OnboardingModule) as unknown[] | undefined;

    expect(exports ?? []).toEqual([]);
  });
});
