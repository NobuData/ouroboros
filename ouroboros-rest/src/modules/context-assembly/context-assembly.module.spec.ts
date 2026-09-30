/** The context-assembly module's wiring ([#414](https://github.com/NobuData/ouroboros/issues/414)). */

import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { ContextAssemblyController } from "./context-assembly.controller";
import { ContextAssemblyModule } from "./context-assembly.module";
import { ContextAssemblyRepository } from "./context-assembly.repository";
import { ContextAssemblyService } from "./context-assembly.service";

describe("the context-assembly module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), ContextAssemblyModule],
    }).compile();

    expect(moduleRef.get(ContextAssemblyController)).toBeInstanceOf(ContextAssemblyController);
    expect(moduleRef.get(ContextAssemblyService)).toBeInstanceOf(ContextAssemblyService);
    expect(moduleRef.get(ContextAssemblyRepository)).toBeInstanceOf(ContextAssemblyRepository);

    await moduleRef.close();
  });

  it("exports the service alone — every consumer reaches the one resolution", () => {
    expect(Reflect.getMetadata("exports", ContextAssemblyModule)).toEqual([ContextAssemblyService]);
  });
});
