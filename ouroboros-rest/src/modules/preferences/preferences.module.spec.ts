import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { PreferencesController } from "./preferences.controller";
import { PreferencesModule } from "./preferences.module";
import { PreferencesRepository } from "./preferences.repository";
import { PreferencesService } from "./preferences.service";

/**
 * The wiring — the one thing about a Nest module that can be wrong at run time and right at
 * compile time, per `tenancy.module.spec.ts`, whose argument this borrows whole: a missing
 * provider or a forgotten `DbModule` import is a green typecheck and a boot failure, and
 * compiling the module here turns that into a unit test.
 *
 * Nothing connects: `pg` connects lazily, so the `DatabaseService` this resolves holds no
 * connection until a query is issued, and none is.
 */

describe("the preferences module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), PreferencesModule],
    }).compile();

    expect(moduleRef.get(PreferencesController)).toBeInstanceOf(PreferencesController);
    expect(moduleRef.get(PreferencesService)).toBeInstanceOf(PreferencesService);
    expect(moduleRef.get(PreferencesRepository)).toBeInstanceOf(PreferencesRepository);

    await moduleRef.close();
  });

  it("exports nothing", () => {
    // The only way to a preference is the route: an exported service would be an invitation
    // to read or write settings from some other module, past the session scoping.
    const exports = Reflect.getMetadata("exports", PreferencesModule) as unknown[] | undefined;

    expect(exports ?? []).toEqual([]);
  });
});
