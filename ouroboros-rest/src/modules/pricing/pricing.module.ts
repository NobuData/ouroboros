/**
 * Pricing — the one resolution of *what does this model cost?*, over V012's `model_prices`
 * ([#586](https://github.com/NobuData/ouroboros/issues/586)).
 *
 * The same three layers as everywhere, with one more:
 *
 * ```
 * controller  the override routes, the role gate     → pricing.controller.ts
 * service     precedence, normalisation, the cache   → pricing.service.ts
 * repository  the statements, and nothing else       → pricing.repository.ts
 * cache       the short-TTL memory in front of them  → pricing.cache.ts
 * ```
 *
 * Two files beside them carry the rules rather than the plumbing: `price.ts` is the four render
 * shapes and the fifth that is an absence, and `resources.ts` is the row-to-contract seam.
 *
 * **This is the first module here that exports its service, and that is the point of the
 * ticket.** Everywhere else, the routes are the surface and nothing is exported — a module that
 * exported a provider would be inviting a second caller to bypass its controller. Here the
 * second caller is the reason the module exists: DASH-J.4 (#92), Z.5 (#198), AB.4 (#210) and
 * CH.5 (#588) all have to price something, and the alternative to importing `PricingModule` is
 * four re-implementations of a precedence rule about money. The export *is* the internal
 * contract those tickets were told to consume.
 *
 * `PricingCache` is a provider rather than a value for the reason `SettingsAudit` is: the seam
 * that #598's catalog refresh will call — `PricingService.invalidateCatalog()` — has to be a
 * real binding now, or that ticket will be replacing a comment rather than an implementation.
 *
 * It imports `DbModule` for the reason every module with a repository does: the import is the
 * answer to "who can reach `model_prices`", and `DbModule` is deliberately non-global so the
 * question has one.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { PricingCache } from "./pricing.cache";
import { PricingController } from "./pricing.controller";
import { PricingRepository } from "./pricing.repository";
import { PricingService } from "./pricing.service";

@Module({
  imports: [DbModule],
  controllers: [PricingController],
  providers: [PricingService, PricingRepository, PricingCache],
  // The one export, and the ticket's *internal contract for consumers*. The repository and the
  // cache stay private: a consumer that reached past the service would be a consumer that had
  // skipped the normalisation, the cache or both.
  exports: [PricingService],
})
export class PricingModule {}
