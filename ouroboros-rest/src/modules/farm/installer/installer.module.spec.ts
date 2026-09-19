import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../../config/config.module";
import { testConfiguration } from "../../config/configuration.fixture";
import { InstallScriptController, RunnerReleaseController } from "./installer.controller";
import { FarmInstallerModule } from "./installer.module";
import { InstallerService } from "./installer.service";

/**
 * The wiring (#248). It needs the configuration and nothing else — no database, no vault —
 * which is the reason it is a module of its own rather than more of `FarmModule`.
 */

describe("the farm installer module", () => {
  it("compiles on the configuration alone, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), FarmInstallerModule],
    }).compile();

    expect(moduleRef.get(InstallScriptController)).toBeInstanceOf(InstallScriptController);
    expect(moduleRef.get(RunnerReleaseController)).toBeInstanceOf(RunnerReleaseController);
    expect(moduleRef.get(InstallerService)).toBeInstanceOf(InstallerService);

    await moduleRef.close();
  });
});
