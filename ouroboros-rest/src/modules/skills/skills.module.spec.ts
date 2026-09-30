/** The skills module's wiring ([#410](https://github.com/NobuData/ouroboros/issues/410)). */

import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { SkillsController } from "./skills.controller";
import { SkillsModule } from "./skills.module";
import { SkillsRegistryService } from "./skills.registry.service";
import { SkillsRepository } from "./skills.repository";
import { SkillsService } from "./skills.service";

describe("the skills module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), SkillsModule],
    }).compile();

    expect(moduleRef.get(SkillsController)).toBeInstanceOf(SkillsController);
    expect(moduleRef.get(SkillsService)).toBeInstanceOf(SkillsService);
    expect(moduleRef.get(SkillsRegistryService)).toBeInstanceOf(SkillsRegistryService);
    expect(moduleRef.get(SkillsRepository)).toBeInstanceOf(SkillsRepository);

    await moduleRef.close();
  });

  it("exports only the registry read the workflow studio needs", () => {
    const exports = Reflect.getMetadata("exports", SkillsModule) as unknown[] | undefined;

    expect(exports).toEqual([SkillsRegistryService]);
  });

  it("imports nothing of the workflow module, so the two cannot form a cycle", () => {
    const imports = (Reflect.getMetadata("imports", SkillsModule) as { name: string }[]).map(
      (imported) => imported.name,
    );

    expect(imports).not.toContain("WorkflowsModule");
  });
});
