/** The rule-file import module's wiring ([#413](https://github.com/NobuData/ouroboros/issues/413)). */

import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { RuleImportController } from "./rule-import.controller";
import { RuleImportModule } from "./rule-import.module";
import { RuleImportRepository } from "./rule-import.repository";
import { RuleImportService } from "./rule-import.service";

describe("the rule-import module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), RuleImportModule],
    }).compile();

    expect(moduleRef.get(RuleImportController)).toBeInstanceOf(RuleImportController);
    expect(moduleRef.get(RuleImportService)).toBeInstanceOf(RuleImportService);
    expect(moduleRef.get(RuleImportRepository)).toBeInstanceOf(RuleImportRepository);

    await moduleRef.close();
  });

  it("exports nothing", () => {
    expect(Reflect.getMetadata("exports", RuleImportModule)).toBeUndefined();
  });
});
