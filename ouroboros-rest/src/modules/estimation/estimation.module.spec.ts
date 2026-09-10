import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DatabaseService } from "../db/db.service";
import { EstimationContextService } from "./estimation.context";
import { EstimationModule } from "./estimation.module";
import { EstimationOrchestrator } from "./estimation.orchestrator";
import { EstimationRepository } from "./estimation.repository";
import { EstimationSweeper } from "./estimation.sweeper";

/**
 * The wiring ([#107](https://github.com/NobuData/ouroboros/issues/107)).
 *
 * Two things worth a suite: that the module resolves at all — it reaches across three other
 * modules for a client, a resolver and a pool — and that its export list is the boundary it
 * says it is. L.4 ([#108](https://github.com/NobuData/ouroboros/issues/108)) is written against
 * exactly one class here, and a repository that leaked out would let a route claim a row
 * without owning what happens to it next.
 *
 * Built with a stand-in `DatabaseService`, because constructing the real one opens a pool —
 * which is precisely what a suite that starts nothing must not do.
 */

describe("the estimation module", () => {
  /**
   * Build the module over a validated configuration and a database that never connects.
   *
   * @returns The compiled testing module.
   */
  async function build() {
    return Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), EstimationModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({})
      .compile();
  }

  it("provides the pipeline, its statements, its context and its loop", async () => {
    const module = await build();

    expect(module.get(EstimationOrchestrator)).toBeInstanceOf(EstimationOrchestrator);
    expect(module.get(EstimationRepository)).toBeInstanceOf(EstimationRepository);
    expect(module.get(EstimationContextService)).toBeInstanceOf(EstimationContextService);
    expect(module.get(EstimationSweeper)).toBeInstanceOf(EstimationSweeper);
  });

  it("declares no controller — the re-estimation routes are L.4's", async () => {
    const module = await build();

    // `POST /backlog/:id/estimate` and `POST /backlog/estimate-all` are #108's; this ticket
    // owns the pipeline they will call, which is why the orchestrator is exported and no route
    // is mounted. Asserted over the decorator's metadata, which is what Nest itself reads.
    expect(Reflect.getMetadata("controllers", EstimationModule)).toBeUndefined();
    expect(module.get(EstimationOrchestrator)).toBeInstanceOf(EstimationOrchestrator);
  });

  it("exports the orchestrator and nothing else", () => {
    const exported = Reflect.getMetadata("exports", EstimationModule) as unknown[];

    expect(exported).toEqual([EstimationOrchestrator]);
  });

  it("gives the orchestrator the concurrency the environment asked for", async () => {
    // The queue is constructed rather than injected, so the only way the bound is observably
    // the configured one is through what the queue then refuses to run at once.
    const module = await Test.createTestingModule({
      imports: [
        ConfigurationModule.forRoot(testConfiguration({ OURO_ESTIMATION_CONCURRENCY: "1" })),
        EstimationModule,
      ],
    })
      .overrideProvider(DatabaseService)
      .useValue({})
      .compile();

    const orchestrator = module.get(EstimationOrchestrator);

    expect(orchestrator.enqueue("first")).toBe(true);
    expect(orchestrator.enqueue("first")).toBe(false);
    expect(orchestrator.estimating("first")).toBe(true);
  });
});
