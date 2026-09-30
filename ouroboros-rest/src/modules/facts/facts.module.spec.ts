/** The facts module's wiring ([#411](https://github.com/NobuData/ouroboros/issues/411)). */

import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { FactsController } from "./facts.controller";
import { FactsModule } from "./facts.module";
import { FACT_COMMIT_OBSERVER } from "./facts.observer";
import { FactsRepository } from "./facts.repository";
import { FactSweepScheduler } from "./facts.scheduler";
import { FactsService } from "./facts.service";
import { FactSweepService } from "./facts.sweep";

describe("the facts module", () => {
  it("compiles, resolves every layer, and binds the commit observer to the sweep", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), FactsModule],
    }).compile();

    expect(moduleRef.get(FactsController)).toBeInstanceOf(FactsController);
    expect(moduleRef.get(FactsService)).toBeInstanceOf(FactsService);
    expect(moduleRef.get(FactsRepository)).toBeInstanceOf(FactsRepository);
    expect(moduleRef.get(FactSweepScheduler)).toBeInstanceOf(FactSweepScheduler);
    expect(moduleRef.get(FACT_COMMIT_OBSERVER)).toBe(moduleRef.get(FactSweepService));

    await moduleRef.close();
  });

  it("exports the proposers' entry point and the commit observer, nothing else", () => {
    const exports = Reflect.getMetadata("exports", FactsModule) as unknown[] | undefined;

    expect(exports).toEqual([FactsService, FACT_COMMIT_OBSERVER]);
  });

  it("imports nothing of the PR plane, so the two cannot form a cycle", () => {
    const imports = (Reflect.getMetadata("imports", FactsModule) as { name?: string }[]).map(
      (imported) => imported.name,
    );

    expect(imports).not.toContain("PullRequestsModule");
  });
});
