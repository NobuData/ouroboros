import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { QueueController } from "./queue.controller";
import { QueueModule } from "./queue.module";
import { QueueRepository } from "./queue.repository";
import { QueueService } from "./queue.service";

/**
 * The wiring — the one thing about a Nest module that can be wrong at run time and right at
 * compile time; `tenancy.module.spec.ts` carries the argument. Nothing connects: `pg`
 * connects lazily, and no query is issued.
 */

describe("the queue module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), QueueModule],
    }).compile();

    expect(moduleRef.get(QueueController)).toBeInstanceOf(QueueController);
    expect(moduleRef.get(QueueService)).toBeInstanceOf(QueueService);
    expect(moduleRef.get(QueueRepository)).toBeInstanceOf(QueueRepository);

    await moduleRef.close();
  });

  it("exports nothing", () => {
    // The routes are the surface — the dashboard module's own rule, kept here so the
    // issues screen's queue writes (mockup 03) publish their own statements rather than
    // reaching through.
    const exports = Reflect.getMetadata("exports", QueueModule) as unknown[] | undefined;

    expect(exports ?? []).toEqual([]);
  });
});
