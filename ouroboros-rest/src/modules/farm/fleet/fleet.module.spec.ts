import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../../config/config.module";
import { testConfiguration } from "../../config/configuration.fixture";
import { FleetController } from "./fleet.controller";
import { FarmFleetModule } from "./fleet.module";
import { FleetRepository } from "./fleet.repository";
import { FleetService } from "./fleet.service";
import { FarmPoolsController } from "./pools.controller";
import { PoolsService } from "./pools.service";
import { FarmRunnersController } from "./runners.controller";
import { RunnersService } from "./runners.service";

/**
 * The wiring — the one thing about a Nest module that can be wrong at run time and right at
 * compile time. Nothing connects: `pg` connects lazily, and no query is issued.
 *
 * The export list gets its own assertion for the reason `farm.module.spec.ts` gives, with the
 * opposite answer: this module exports **nothing**. Its routes are its surface, and the UI
 * tickets it feeds are clients over HTTP rather than modules — so an export appearing here
 * would be a second caller reaching past the role gates on those routes.
 */

describe("the farm fleet module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), FarmFleetModule],
    }).compile();

    expect(moduleRef.get(FleetController)).toBeInstanceOf(FleetController);
    expect(moduleRef.get(FarmRunnersController)).toBeInstanceOf(FarmRunnersController);
    expect(moduleRef.get(FarmPoolsController)).toBeInstanceOf(FarmPoolsController);
    expect(moduleRef.get(FleetService)).toBeInstanceOf(FleetService);
    expect(moduleRef.get(RunnersService)).toBeInstanceOf(RunnersService);
    expect(moduleRef.get(PoolsService)).toBeInstanceOf(PoolsService);
    expect(moduleRef.get(FleetRepository)).toBeInstanceOf(FleetRepository);

    await moduleRef.close();
  });

  it("imports the three farm modules it borrows a capability from", () => {
    // `FarmModule` for the revocation a removal performs, `FarmGatewayModule` for the drain
    // channel and the clock the stat row's ages share with the heartbeat that wrote them,
    // and `AuditModule` because every mutation here writes an event.
    const imported = (Reflect.getMetadata("imports", FarmFleetModule) as { name?: string }[]).map(
      (module) => module.name,
    );

    expect(imported).toEqual(["DbModule", "AuditModule", "FarmModule", "FarmGatewayModule"]);
  });

  it("exports nothing — its routes are its surface", () => {
    const exported = Reflect.getMetadata("exports", FarmFleetModule) as unknown[] | undefined;

    expect(exported).toBeUndefined();
  });
});
