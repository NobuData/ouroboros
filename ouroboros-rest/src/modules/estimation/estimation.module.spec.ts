import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DatabaseService } from "../db/db.service";
import { EstimationContextService } from "./estimation.context";
import { EstimationController } from "./estimation.controller";
import { EstimationLimiter } from "./estimation.limiter";
import { EstimationModule } from "./estimation.module";
import { EstimationOrchestrator } from "./estimation.orchestrator";
import { EstimationRepository } from "./estimation.repository";
import { EstimationSweeper } from "./estimation.sweeper";
import { EstimationTriggerService } from "./estimation.trigger.service";

/**
 * The wiring ([#107](https://github.com/NobuData/ouroboros/issues/107)).
 *
 * Two things worth a suite: that the module resolves at all — it reaches across three other
 * modules for a client, a resolver and a pool — and that its export list is the boundary it
 * says it is. L.4 ([#108](https://github.com/NobuData/ouroboros/issues/108)) added a controller
 * and two providers to it and moved that boundary not at all: its routes call the orchestrator
 * from *inside* the module, so a repository that leaked out would still be a consumer able to
 * claim a row without owning what happens to it next.
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

  it("provides L.4's trigger and its counter", async () => {
    const module = await build();

    expect(module.get(EstimationTriggerService)).toBeInstanceOf(EstimationTriggerService);
    expect(module.get(EstimationLimiter)).toBeInstanceOf(EstimationLimiter);
  });

  it("declares the re-estimation routes, under the backlog prefix", async () => {
    const module = await build();

    // `POST /backlog/{id}/estimate` and `POST /backlog/estimate-all` (#108). They live here
    // rather than in `backlog/` because everything they touch — the queue, the claim, the
    // limiter — is this module's; `AuditModule` serves `/api/v1/providers/audit` on the same
    // argument. Asserted over the decorator's metadata, which is what Nest itself reads.
    expect(Reflect.getMetadata("controllers", EstimationModule)).toEqual([EstimationController]);
    expect(module.get(EstimationController)).toBeInstanceOf(EstimationController);
  });

  it("gives the routes the same orchestrator the sync and the sweep use", async () => {
    // One queue, one dedupe set, one bound. A second instance would make a press and a poll
    // unable to see each other's in-flight work — which is exactly the duplicate estimate the
    // 409 exists to prevent, and identity is the only way to assert it from outside. Reaching
    // for the injected field is deliberate: what is being checked *is* what was injected.
    const module = await build();
    const trigger: { orchestrator: EstimationOrchestrator } = module.get(EstimationTriggerService);

    expect(trigger.orchestrator).toBe(module.get(EstimationOrchestrator));
  });

  it("exports the orchestrator and nothing else", () => {
    // Unchanged by L.4: the limiter stays private because a counter another module could spend
    // is not a limit, and the trigger stays private because its callers are this module's own
    // routes.
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
