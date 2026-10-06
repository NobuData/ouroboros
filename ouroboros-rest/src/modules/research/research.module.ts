/**
 * `ResearchModule` — mockup 22's Research domain, starting with CM.3's scope and cost estimate
 * ([#622](https://github.com/NobuData/ouroboros/issues/622)).
 *
 * It consumes routing (the `research` task kind's resolution, Z.1) and pricing (CH.3) through
 * their exported services only, and exports {@link ResearchEstimateService} — the contract CM.6
 * (#625) stores estimates through and CM.1 (#620) reconciles actuals through.
 * {@link ResearchToolPricing} is a provider so CL.2 (#615) can replace it with one reading its
 * hosted providers' cost metadata.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { PricingModule } from "../pricing/pricing.module";
import { RoutingModule } from "../routing/routing.module";
import { ResearchEstimateController } from "./estimate.controller";
import { ResearchEstimateService } from "./estimate.service";
import { ResearchRepository } from "./research.repository";
import { ResearchToolPricing } from "./tool-pricing";

@Module({
  imports: [DbModule, RoutingModule, PricingModule],
  controllers: [ResearchEstimateController],
  providers: [ResearchEstimateService, ResearchRepository, ResearchToolPricing],
  exports: [ResearchEstimateService],
})
export class ResearchModule {}
