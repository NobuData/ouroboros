import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { ControlsController } from "./controls.controller";
import { ControlsInternalController } from "./controls.internal.controller";
import { ControlsModule } from "./controls.module";
import { ControlsRepository } from "./controls.repository";
import { ControlsService } from "./controls.service";
import { ControlsSweeper } from "./controls.sweeper";

/**
 * The wiring (#306). Nothing here connects: `pg` connects lazily and no query is issued, and
 * the sweeper's loop starts on bootstrap, which a compiled testing module does not reach.
 */

describe("the controls module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), ControlsModule],
    }).compile();

    expect(moduleRef.get(ControlsController)).toBeInstanceOf(ControlsController);
    expect(moduleRef.get(ControlsInternalController)).toBeInstanceOf(ControlsInternalController);
    expect(moduleRef.get(ControlsService)).toBeInstanceOf(ControlsService);
    expect(moduleRef.get(ControlsRepository)).toBeInstanceOf(ControlsRepository);
    expect(moduleRef.get(ControlsSweeper)).toBeInstanceOf(ControlsSweeper);

    await moduleRef.close();
  });

  it("registers no guard of its own, because InternalModule's APP_GUARD protects its routes", () => {
    const providers = Reflect.getMetadata("providers", ControlsModule) as { provide?: unknown }[];

    expect(providers.some((provider) => provider.provide === "APP_GUARD")).toBe(false);
  });

  it("exports nothing, so there is no in-process path around the role policy", () => {
    expect(Reflect.getMetadata("exports", ControlsModule)).toBeUndefined();
  });
});
