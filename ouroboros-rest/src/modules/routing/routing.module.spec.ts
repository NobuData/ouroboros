import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { ResolutionService } from "./resolution.service";
import { RoutingModule } from "./routing.module";
import { RoutingRepository } from "./routing.repository";

/**
 * The wiring — the one thing about a Nest module that can be wrong at run time and right at
 * compile time; `tenancy.module.spec.ts` carries the argument. Nothing connects: `pg` connects
 * lazily and the module is compiled rather than initialised.
 *
 * Two assertions here are contracts rather than checks. The **export** is what Z.4 (#197),
 * AB.5 (#211) and CH.6 (#589) were all told to consume, and an export removed in a refactor
 * would send one of them back to re-implementing resolution. The **absent controller** is the
 * ticket's scope: Z.1 is the engine, and the HTTP surfaces over it belong to Z.2 and Z.4.
 */

describe("the routing module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), RoutingModule],
    }).compile();

    expect(moduleRef.get(ResolutionService)).toBeInstanceOf(ResolutionService);
    expect(moduleRef.get(RoutingRepository)).toBeInstanceOf(RoutingRepository);

    await moduleRef.close();
  });

  it("exports the service, and only the service", () => {
    // The repository stays private: a consumer reaching past the service would be a consumer
    // holding rows instead of a resolution, and rows carry no explanations.
    const exports = Reflect.getMetadata("exports", RoutingModule) as unknown[] | undefined;

    expect(exports).toEqual([ResolutionService]);
  });

  it("declares no controller, because the engine is not an endpoint", () => {
    const controllers = Reflect.getMetadata("controllers", RoutingModule) as unknown[] | undefined;

    expect(controllers ?? []).toEqual([]);
  });
});
