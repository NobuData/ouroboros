import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { RoutingManagementRepository } from "./management.repository";
import { RoutingManagementService } from "./management.service";
import { ResolutionService } from "./resolution.service";
import { RoutingController } from "./routing.controller";
import { RoutingModule } from "./routing.module";
import { RoutingRepository } from "./routing.repository";
import { RoutingStatsCache } from "./stats.cache";
import { RoutingStatsRepository } from "./stats.repository";
import { RoutingStatsService } from "./stats.service";
import { SimulateController } from "./simulate.controller";

/**
 * The wiring — the one thing about a Nest module that can be wrong at run time and right at
 * compile time; `tenancy.module.spec.ts` carries the argument. Nothing connects: `pg` connects
 * lazily and the module is compiled rather than initialised.
 *
 * Two assertions here are contracts rather than checks. The **export** is what AB.5 (#211)
 * and CH.6 (#589) were told to consume, and an export removed in a refactor would send one of
 * them back to re-implementing resolution. The **two controllers** are the module's two
 * surfaces (#195 and #197) and their order is the seam: the editor's routes and, separately,
 * the engine's one. A third appearing here would be this module answering a question another
 * ticket owns the shape of.
 */

describe("the routing module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), RoutingModule],
    }).compile();

    expect(moduleRef.get(ResolutionService)).toBeInstanceOf(ResolutionService);
    expect(moduleRef.get(RoutingRepository)).toBeInstanceOf(RoutingRepository);
    expect(moduleRef.get(RoutingManagementService)).toBeInstanceOf(RoutingManagementService);
    expect(moduleRef.get(RoutingManagementRepository)).toBeInstanceOf(RoutingManagementRepository);
    expect(moduleRef.get(RoutingStatsService)).toBeInstanceOf(RoutingStatsService);
    expect(moduleRef.get(RoutingStatsRepository)).toBeInstanceOf(RoutingStatsRepository);
    expect(moduleRef.get(RoutingStatsCache)).toBeInstanceOf(RoutingStatsCache);
    expect(moduleRef.get(RoutingController)).toBeInstanceOf(RoutingController);
    expect(moduleRef.get(SimulateController)).toBeInstanceOf(SimulateController);

    await moduleRef.close();
  });

  it("exports the resolution service, and only that", () => {
    // Both repositories stay private: a consumer reaching past the service would be a consumer
    // holding rows instead of a resolution, and rows carry no explanations. The management
    // service stays private for the sharper version of the same reason — it writes, and a
    // module that could inject it could edit another surface's routes. The stats service stays
    // private too: AB.4 (#210) is a UI surface and reads `GET /routing/spend` like any other
    // client, so exporting it would only create a second way into the same numbers.
    const exports = Reflect.getMetadata("exports", RoutingModule) as unknown[] | undefined;

    expect(exports).toEqual([ResolutionService]);
  });

  it("declares the editor's controller and the engine's, and only those two", () => {
    // Two surfaces over four shared tables, and the split is `routing.module.ts`'s: the editor
    // writes routes and rules, and the engine answers *which model runs this*. A controller
    // added here without a ticket that owns its shape is what this assertion is for.
    const controllers = Reflect.getMetadata("controllers", RoutingModule) as unknown[] | undefined;

    expect(controllers).toEqual([RoutingController, SimulateController]);
  });
});
