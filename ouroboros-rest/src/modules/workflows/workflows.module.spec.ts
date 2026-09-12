import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { WorkflowPublishGate } from "./publish.gate";
import { WorkflowRegistryService } from "./registry.service";
import { WorkflowStatsRepository } from "./stats.repository";
import { WorkflowStatsService } from "./stats.service";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowsModule } from "./workflows.module";
import { WorkflowsRepository } from "./workflows.repository";
import { WorkflowsService } from "./workflows.service";

/**
 * The wiring — the one thing about a Nest module that can be wrong at run time and right at
 * compile time; `tenancy.module.spec.ts` carries the argument. Nothing connects: `pg` connects
 * lazily, and no query is issued.
 *
 * The exports are asserted rather than assumed, because they are the ticket's internal contract
 * for consumers: P.3 ([#134](https://github.com/NobuData/ouroboros/issues/134)) composes its
 * rail payload from `WorkflowStatsService`, and `BacklogModule` and `EstimationModule` already
 * read the vocabulary through `WorkflowRegistryService`. An export removed in a refactor sends
 * the next consumer back to writing its own derivation, which is the drift this module exists
 * to prevent.
 */

describe("the workflows module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), WorkflowsModule],
    }).compile();

    expect(moduleRef.get(WorkflowStatsService)).toBeInstanceOf(WorkflowStatsService);
    expect(moduleRef.get(WorkflowRegistryService)).toBeInstanceOf(WorkflowRegistryService);
    expect(moduleRef.get(WorkflowStatsRepository)).toBeInstanceOf(WorkflowStatsRepository);
    expect(moduleRef.get(WorkflowsService)).toBeInstanceOf(WorkflowsService);
    expect(moduleRef.get(WorkflowsRepository)).toBeInstanceOf(WorkflowsRepository);
    expect(moduleRef.get(WorkflowPublishGate)).toBeInstanceOf(WorkflowPublishGate);
    expect(moduleRef.get(WorkflowsController)).toBeInstanceOf(WorkflowsController);

    await moduleRef.close();
  });

  it("exports the two services, and not the repository", () => {
    // A consumer that reached past them would be a consumer that had skipped the honesty
    // rules — the captions, the null share, the bootstrap vocabulary — which are the whole of
    // what those two files are.
    const exports = Reflect.getMetadata("exports", WorkflowsModule) as unknown[] | undefined;

    expect(exports).toEqual([WorkflowStatsService, WorkflowRegistryService]);
  });

  it("declares the lifecycle controller, and only that one", () => {
    // P.3 ([#134](https://github.com/NobuData/ouroboros/issues/134)) is the surface over P.4's
    // derivation, and a second controller publishing its own listing would be two answers to
    // *what is on the rail*.
    const controllers = Reflect.getMetadata("controllers", WorkflowsModule) as
      unknown[] | undefined;

    expect(controllers).toEqual([WorkflowsController]);
  });

  it("imports the engine, because the publish gate asks it for a second opinion", () => {
    // `docs/ARCHITECTURE.md` § 3.2: the UI never calls the engine, this service does. The
    // import is the answer to *who may call the engine about a workflow*.
    const imports = (Reflect.getMetadata("imports", WorkflowsModule) as { name?: string }[]).map(
      (imported) => imported.name,
    );

    expect(imports).toContain("EngineModule");
  });

  it("is importable on its own, so a consumer gets the services and nothing else", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), WorkflowsModule],
    }).compile();

    expect(moduleRef.get(WorkflowRegistryService)).toBeInstanceOf(WorkflowRegistryService);

    await moduleRef.close();
  });
});
