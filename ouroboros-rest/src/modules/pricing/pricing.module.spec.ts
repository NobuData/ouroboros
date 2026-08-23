import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { PricingCache } from "./pricing.cache";
import { PricingController } from "./pricing.controller";
import { PricingModule } from "./pricing.module";
import { PricingRepository } from "./pricing.repository";
import { PricingService } from "./pricing.service";

/**
 * The wiring — the one thing about a Nest module that can be wrong at run time and right at
 * compile time; `tenancy.module.spec.ts` carries the argument. Nothing connects: `pg` connects
 * lazily, and no query is issued.
 *
 * The export is asserted rather than assumed, because it is the ticket's *internal contract for
 * consumers*: DASH-J.4 (#92), Z.5 (#198), AB.4 (#210) and CH.5 (#588) were all told to consume
 * this rather than re-invent it, and an export removed in a refactor would send the next one of
 * them back to writing their own precedence rule.
 */

describe("the pricing module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), PricingModule],
    }).compile();

    expect(moduleRef.get(PricingController)).toBeInstanceOf(PricingController);
    expect(moduleRef.get(PricingService)).toBeInstanceOf(PricingService);
    expect(moduleRef.get(PricingRepository)).toBeInstanceOf(PricingRepository);
    expect(moduleRef.get(PricingCache)).toBeInstanceOf(PricingCache);

    await moduleRef.close();
  });

  it("exports the service, and only the service", () => {
    // The repository and the cache stay private: a consumer that reached past the service would
    // be a consumer that had skipped the folding, the cache, or both — and the folding is what
    // stops a capital letter rendering `—` for a priced model.
    const exports = Reflect.getMetadata("exports", PricingModule) as unknown[] | undefined;

    expect(exports).toEqual([PricingService]);
  });

  it("is importable on its own, so a consumer gets the service and nothing else", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), PricingModule],
    }).compile();

    expect(moduleRef.get(PricingService)).toBeInstanceOf(PricingService);

    await moduleRef.close();
  });
});
