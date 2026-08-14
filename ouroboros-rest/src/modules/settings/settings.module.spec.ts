import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { SettingsAudit } from "./audit";
import { SettingsController } from "./settings.controller";
import { SettingsModule } from "./settings.module";
import { SettingsRepository } from "./settings.repository";
import { SettingsService } from "./settings.service";

/**
 * The wiring — the one thing about a Nest module that can be wrong at run time and right at
 * compile time; `tenancy.module.spec.ts` carries the argument. Nothing connects: `pg`
 * connects lazily, and no query is issued.
 */

describe("the settings module", () => {
  it("compiles, and resolves every layer — the audit seam included", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), SettingsModule],
    }).compile();

    expect(moduleRef.get(SettingsController)).toBeInstanceOf(SettingsController);
    expect(moduleRef.get(SettingsService)).toBeInstanceOf(SettingsService);
    expect(moduleRef.get(SettingsRepository)).toBeInstanceOf(SettingsRepository);
    expect(moduleRef.get(SettingsAudit)).toBeInstanceOf(SettingsAudit);

    await moduleRef.close();
  });

  it("exports nothing", () => {
    // The routes are the surface. The merge logic that will act on the switch (v2) reads
    // the effective view; #90's audit path replaces a provider *inside* this module.
    const exports = Reflect.getMetadata("exports", SettingsModule) as unknown[] | undefined;

    expect(exports ?? []).toEqual([]);
  });
});
