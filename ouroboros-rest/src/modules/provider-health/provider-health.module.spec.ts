import { Test } from "@nestjs/testing";
import { SchedulerRegistry } from "@nestjs/schedule";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { ProviderProbe } from "./probe.client";
import { ProviderHealthController } from "./provider-health.controller";
import { ProviderHealthModule } from "./provider-health.module";
import { ProviderHealthRepository } from "./provider-health.repository";
import { ProviderHealthScheduler } from "./provider-health.scheduler";
import { ProviderHealthService } from "./provider-health.service";

/**
 * The wiring — the one thing about a Nest module that can be wrong at run time and right at
 * compile time; `tenancy.module.spec.ts` carries the argument. Nothing connects: `pg` connects
 * lazily, the module is compiled rather than initialised, and so the sweep never starts.
 *
 * The export is asserted rather than assumed, because it is the ticket's internal contract:
 * Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194)) and AA.1
 * ([#200](https://github.com/NobuData/ouroboros/issues/200)) were both told to consume health
 * through this service, and an export removed in a refactor would send one of them back to
 * checking a provider from inside a resolver.
 */

describe("the provider health module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), ProviderHealthModule],
    }).compile();

    expect(moduleRef.get(ProviderHealthController)).toBeInstanceOf(ProviderHealthController);
    expect(moduleRef.get(ProviderHealthService)).toBeInstanceOf(ProviderHealthService);
    expect(moduleRef.get(ProviderHealthRepository)).toBeInstanceOf(ProviderHealthRepository);
    expect(moduleRef.get(ProviderProbe)).toBeInstanceOf(ProviderProbe);
    expect(moduleRef.get(ProviderHealthScheduler)).toBeInstanceOf(ProviderHealthScheduler);

    await moduleRef.close();
  });

  it("brings the scheduler registry the loop books its timer with", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), ProviderHealthModule],
    }).compile();

    expect(moduleRef.get(SchedulerRegistry)).toBeInstanceOf(SchedulerRegistry);

    await moduleRef.close();
  });

  it("exports the service, and only the service", () => {
    // The repository, the probe and the scheduler stay private. A consumer reaching past the
    // service would be a consumer that had skipped the *nothing checks on demand* rule.
    const exports = Reflect.getMetadata("exports", ProviderHealthModule) as unknown[] | undefined;

    expect(exports).toEqual([ProviderHealthService]);
  });

  it("starts nothing until an application is bootstrapped", async () => {
    // `compile()` runs no lifecycle hook, which is what lets this suite exist without a
    // database — and is also the property that keeps every other module spec in this service
    // from acquiring a minute-long timer.
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), ProviderHealthModule],
    }).compile();

    expect(moduleRef.get(SchedulerRegistry).getTimeouts()).toEqual([]);

    await moduleRef.close();
  });
});
