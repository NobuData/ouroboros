import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { SettingsAudit } from "./audit";
import { SettingsController } from "./settings.controller";
import { SettingsModule } from "./settings.module";
import { SettingsRepository } from "./settings.repository";
import { SettingsService } from "./settings.service";
import { WORKSPACE_NAME_STORE } from "./workspace.auth";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceRepository } from "./workspace.repository";
import { WorkspaceService } from "./workspace.service";
import { SsoEnforcement } from "./workspace.sso";

/**
 * The wiring — the one thing about a Nest module that can be wrong at run time and right at
 * compile time; `tenancy.module.spec.ts` carries the argument. Nothing connects: `pg`
 * connects lazily, and no query is issued.
 */

describe("the settings module", () => {
  it("compiles, and resolves every layer — the audit seam included", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), SettingsModule],
    })
      // BetterAuth is the one edge a unit container has nothing behind; the rename seam is
      // replaced rather than the library, so every other provider is the real graph.
      .overrideProvider(WORKSPACE_NAME_STORE)
      .useValue({ rename: jest.fn() })
      .compile();

    expect(moduleRef.get(SettingsController)).toBeInstanceOf(SettingsController);
    expect(moduleRef.get(SettingsService)).toBeInstanceOf(SettingsService);
    expect(moduleRef.get(SettingsRepository)).toBeInstanceOf(SettingsRepository);
    expect(moduleRef.get(SettingsAudit)).toBeInstanceOf(SettingsAudit);
    // The workspace card (#483).
    expect(moduleRef.get(WorkspaceController)).toBeInstanceOf(WorkspaceController);
    expect(moduleRef.get(WorkspaceService)).toBeInstanceOf(WorkspaceService);
    expect(moduleRef.get(WorkspaceRepository)).toBeInstanceOf(WorkspaceRepository);
    expect(moduleRef.get(SsoEnforcement)).toBeInstanceOf(SsoEnforcement);

    await moduleRef.close();
  });

  it("exports nothing", () => {
    // The routes are the surface. The merge logic that will act on the switch (v2) reads
    // the effective view; #90's audit path replaces a provider *inside* this module.
    const exports = Reflect.getMetadata("exports", SettingsModule) as unknown[] | undefined;

    expect(exports ?? []).toEqual([]);
  });
});
