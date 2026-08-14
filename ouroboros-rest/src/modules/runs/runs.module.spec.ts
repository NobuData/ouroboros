import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { RunsController } from "./runs.controller";
import { RunsModule } from "./runs.module";
import { RunsRepository } from "./runs.repository";
import { RunsService } from "./runs.service";

/**
 * The wiring — the one thing about a Nest module that can be wrong at run time and right at
 * compile time; `tenancy.module.spec.ts` carries the argument. Nothing connects: `pg`
 * connects lazily, and no query is issued.
 */

describe("the runs module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), RunsModule],
    }).compile();

    expect(moduleRef.get(RunsController)).toBeInstanceOf(RunsController);
    expect(moduleRef.get(RunsService)).toBeInstanceOf(RunsService);
    expect(moduleRef.get(RunsRepository)).toBeInstanceOf(RunsRepository);

    await moduleRef.close();
  });

  it("exports nothing", () => {
    // The routes are the surface — the dashboard module's own rule, kept here so the queue
    // and settings drill-ins publish their own statements rather than reaching through.
    const exports = Reflect.getMetadata("exports", RunsModule) as unknown[] | undefined;

    expect(exports ?? []).toEqual([]);
  });
});
