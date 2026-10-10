import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../../config/config.module";
import { testConfiguration } from "../../config/configuration.fixture";
import { InvestigationLifecycleController } from "./lifecycle.controller";
import { InvestigationLifecycleModule } from "./lifecycle.module";
import { LifecycleRepository } from "./lifecycle.repository";
import { InvestigationLifecycleService } from "./lifecycle.service";
import { ResearchSettingsController } from "./research-settings.controller";

/**
 * The wiring. Nothing connects: `pg` connects lazily, and no query is issued. The export is
 * asserted because the planes that open investigations themselves (#623, #638) build on it.
 */
describe("the investigation lifecycle module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), InvestigationLifecycleModule],
    }).compile();

    expect(moduleRef.get(InvestigationLifecycleController)).toBeInstanceOf(
      InvestigationLifecycleController,
    );
    expect(moduleRef.get(ResearchSettingsController)).toBeInstanceOf(ResearchSettingsController);
    expect(moduleRef.get(InvestigationLifecycleService)).toBeInstanceOf(
      InvestigationLifecycleService,
    );
    expect(moduleRef.get(LifecycleRepository)).toBeInstanceOf(LifecycleRepository);

    await moduleRef.close();
  });

  it("exports the lifecycle service", () => {
    expect(Reflect.getMetadata("exports", InvestigationLifecycleModule)).toEqual([
      InvestigationLifecycleService,
    ]);
  });
});
