/**
 * The live-loop readiness preflight (DK.1, [#1318](https://github.com/NobuData/ouroboros/issues/1318)):
 * `GET /api/v1/loop/readiness`.
 *
 * It reads; it owns no table. Its own module rather than `LoopModule`'s because it reads through
 * admission, which imports `LoopModule` — and because the first-run launcher (#388) asks it too.
 */

import { Module } from "@nestjs/common";

import { AdmissionModule } from "../admission/admission.module";
import { DbModule } from "../db/db.module";
import { EngineModule } from "../engine/engine.module";
import { GithubModule } from "../github/github.module";
import { PoliciesModule } from "../policies/policies.module";
import { PricingModule } from "../pricing/pricing.module";
import { RoutingModule } from "../routing/routing.module";
import { TicketSourcesModule } from "../ticket-sources/ticket-sources.module";
import { LoopModule } from "./loop.module";
import { LoopReadinessController } from "./readiness.controller";
import { ReadinessRepository } from "./readiness.repository";
import { ReadinessService } from "./readiness.service";

@Module({
  imports: [
    DbModule,
    LoopModule,
    AdmissionModule,
    EngineModule,
    RoutingModule,
    PricingModule,
    PoliciesModule,
    GithubModule,
    TicketSourcesModule,
  ],
  controllers: [LoopReadinessController],
  providers: [ReadinessRepository, ReadinessService],
  exports: [ReadinessService],
})
export class LoopReadinessModule {}
