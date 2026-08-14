import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DashboardController } from "./dashboard.controller";
import { DashboardModule } from "./dashboard.module";
import { DashboardRepository } from "./dashboard.repository";
import { DashboardService } from "./dashboard.service";

/**
 * The wiring — the one thing about a Nest module that can be wrong at run time and right at
 * compile time: a missing provider or a forgotten `DbModule` import is a green typecheck and
 * a boot failure, and compiling the module here turns that into a unit test.
 *
 * Nothing connects: `pg` connects lazily, so the `DatabaseService` this resolves holds no
 * connection until a query is issued, and none is.
 */

describe("the dashboard module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), DashboardModule],
    }).compile();

    expect(moduleRef.get(DashboardController)).toBeInstanceOf(DashboardController);
    expect(moduleRef.get(DashboardService)).toBeInstanceOf(DashboardService);
    expect(moduleRef.get(DashboardRepository)).toBeInstanceOf(DashboardRepository);

    await moduleRef.close();
  });

  it("exports nothing", () => {
    // #71, #73 and #74 publish their own endpoints over the same rows rather than reaching
    // through this module: an exported service would make the dashboard's card-sized limits
    // and its choice of windows theirs too, and they are not.
    const exports = Reflect.getMetadata("exports", DashboardModule) as unknown[] | undefined;

    expect(exports ?? []).toEqual([]);
  });

  it("says who may reach the read-model by importing DbModule", () => {
    // `DbModule` is deliberately not global, so the import list is the answer to "what can
    // query the dashboard's tables".
    const imports = Reflect.getMetadata("imports", DashboardModule) as { name?: string }[];

    expect(imports.map((imported) => imported.name)).toContain("DbModule");
  });
});
