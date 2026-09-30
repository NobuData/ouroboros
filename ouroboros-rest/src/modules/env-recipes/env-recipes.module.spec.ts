import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { EnvRecipesController } from "./env-recipes.controller";
import { EnvRecipesModule } from "./env-recipes.module";
import { EnvRecipesRepository } from "./env-recipes.repository";
import { EnvRecipesService } from "./env-recipes.service";

/** The wiring (#420). Nothing connects: `pg` connects lazily. */

describe("the env-recipes module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), EnvRecipesModule],
    }).compile();

    expect(moduleRef.get(EnvRecipesController)).toBeInstanceOf(EnvRecipesController);
    expect(moduleRef.get(EnvRecipesService)).toBeInstanceOf(EnvRecipesService);
    expect(moduleRef.get(EnvRecipesRepository)).toBeInstanceOf(EnvRecipesRepository);

    await moduleRef.close();
  });

  it("exports nothing — the consumers read V073's view themselves", () => {
    expect(Reflect.getMetadata("exports", EnvRecipesModule)).toBeUndefined();
  });
});
