import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { ResearchEstimateController } from "./estimate.controller";
import { ResearchEstimateService } from "./estimate.service";
import { ResearchModule } from "./research.module";
import { ResearchRepository } from "./research.repository";
import { ResearchToolPricing } from "./tool-pricing";
import { RegistryToolPricing } from "./tools/research-tool.pricing";

/**
 * The wiring. Nothing connects: `pg` connects lazily, and no query is issued. The export is
 * asserted because it is the contract CM.6 (#625) and CM.1 (#620) store and reconcile through.
 */
describe("the research module", () => {
  it("compiles, and resolves every layer — routing and pricing included", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), ResearchModule],
    }).compile();

    expect(moduleRef.get(ResearchEstimateController)).toBeInstanceOf(ResearchEstimateController);
    expect(moduleRef.get(ResearchEstimateService)).toBeInstanceOf(ResearchEstimateService);
    expect(moduleRef.get(ResearchRepository)).toBeInstanceOf(ResearchRepository);
    expect(moduleRef.get(ResearchToolPricing)).toBeInstanceOf(RegistryToolPricing);

    await moduleRef.close();
  });

  it("exports the estimate service, and only the service", () => {
    expect(Reflect.getMetadata("exports", ResearchModule)).toEqual([ResearchEstimateService]);
  });

  it("binds the registry-backed hosted tool pricing, and still lets a test replace it", async () => {
    class Hosted extends ResearchToolPricing {}

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), ResearchModule],
    })
      .overrideProvider(ResearchToolPricing)
      .useClass(Hosted)
      .compile();

    expect(moduleRef.get(ResearchToolPricing)).toBeInstanceOf(Hosted);

    await moduleRef.close();
  });
});
