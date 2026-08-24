import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { RoutingManagementRepository } from "./management.repository";
import { RoutingManagementService } from "./management.service";
import { ResolutionService } from "./resolution.service";
import { RoutingController } from "./routing.controller";
import { RoutingModule } from "./routing.module";
import { RoutingRepository } from "./routing.repository";

/**
 * The wiring — the one thing about a Nest module that can be wrong at run time and right at
 * compile time; `tenancy.module.spec.ts` carries the argument. Nothing connects: `pg` connects
 * lazily and the module is compiled rather than initialised.
 *
 * Two assertions here are contracts rather than checks. The **export** is what Z.4 (#197),
 * AB.5 (#211) and CH.6 (#589) were all told to consume, and an export removed in a refactor
 * would send one of them back to re-implementing resolution. The **single controller** is
 * Z.2's scope (#195): this module now serves the management API, and it still does not serve
 * `/routing/simulate` — that is Z.4's, and a second controller appearing here would be this
 * module answering a question another ticket owns the shape of.
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
    expect(moduleRef.get(RoutingController)).toBeInstanceOf(RoutingController);

    await moduleRef.close();
  });

  it("exports the resolution service, and only that", () => {
    // Both repositories stay private: a consumer reaching past the service would be a consumer
    // holding rows instead of a resolution, and rows carry no explanations. The management
    // service stays private for the sharper version of the same reason — it writes, and a
    // module that could inject it could edit another surface's routes.
    const exports = Reflect.getMetadata("exports", RoutingModule) as unknown[] | undefined;

    expect(exports).toEqual([ResolutionService]);
  });

  it("declares the management controller, and only it", () => {
    const controllers = Reflect.getMetadata("controllers", RoutingModule) as unknown[] | undefined;

    expect(controllers).toEqual([RoutingController]);
  });
});
