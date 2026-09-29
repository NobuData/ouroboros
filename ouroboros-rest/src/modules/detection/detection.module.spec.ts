/** The detection module's wiring ([#384](https://github.com/NobuData/ouroboros/issues/384)). */

import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DetectionController } from "./detection.controller";
import { DetectionModule } from "./detection.module";
import { RulePackRegistry } from "./detection.registry";
import { DetectionRepository } from "./detection.repository";
import { DetectionService } from "./detection.service";

describe("the detection module", () => {
  it("compiles, resolves every layer, and registers the six core packs", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), DetectionModule],
    }).compile();

    expect(moduleRef.get(DetectionController)).toBeInstanceOf(DetectionController);
    expect(moduleRef.get(DetectionService)).toBeInstanceOf(DetectionService);
    expect(moduleRef.get(DetectionRepository)).toBeInstanceOf(DetectionRepository);
    expect(moduleRef.get(RulePackRegistry).all()).toHaveLength(6);

    await moduleRef.close();
  });
});
