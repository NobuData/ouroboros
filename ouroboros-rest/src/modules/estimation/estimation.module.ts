/**
 * The estimation pipeline — what moves an issue from *mirrored* to *sized* (L.3,
 * [#107](https://github.com/NobuData/ouroboros/issues/107)).
 *
 * ```
 * estimation.queue.ts          the bound, and the dedupe — no database, no engine, no clock
 * estimation.outcome.ts        the confidence floor, and one engine answer as one row
 * estimation.context.ts        the tags and the models an answer may use (Z.4, decision M6)
 * estimation.repository.ts     the claim, the versioned write, the stale read
 * estimation.orchestrator.ts   the state machine, and the only place a failure is decided
 * estimation.sweeper.ts        what makes the recovery sweep periodic
 * estimation.limiter.ts        how often one workspace may ask — L.4's per-org counter
 * estimation.errors.ts         404 · 409 · 429, and why each is the status it is
 * estimation.resources.ts      what an accepted press answers with
 * estimation.trigger.service.ts  the four guards between a press and an engine call
 * estimation.controller.ts     `POST /backlog/{id}/estimate` · `POST /backlog/estimate-all`
 * ```
 *
 * **It has a controller, and it serves `BacklogModule`'s prefix.** The re-estimation endpoints
 * — the panel's button and the head's *Re-estimate all* — are L.4's
 * ([#108](https://github.com/NobuData/ouroboros/issues/108)), and they landed here rather than
 * in `backlog/` because what they *do* is estimation: everything they touch is this module's
 * queue, this module's claim and this module's limiter. What they are *about* is an issue in
 * the backlog, which is where a client looks for them — so the path is `/api/v1/backlog/…` and
 * the module is this one, exactly as `AuditModule` serves `GET /api/v1/providers/audit`.
 * {@link EstimationOrchestrator}'s `enqueue()` and `estimating()` are what L.3 left public for
 * it, and both are still the only way in.
 *
 * **`RoutingModule` is imported, and what it contributes is the Z.4 amendment.** Its one export
 * is `ResolutionService` — the same method `POST /api/v1/routing/simulate` serves — and
 * `estimation.context.ts` fills `model_defaults` from it rather than from configuration, which
 * is decision **M6**'s remaining half. There is no second answer to *which model runs this* for
 * the two to drift apart into.
 *
 * **`EngineModule` is imported for `EngineClient` and nothing else.** Decision **K7**: sizing
 * runs through the engine even while the estimator is a rule engine, because that pipeline
 * shape is the product architecture and v0-vs-v2 is an engine-internal swap.
 *
 * `ScheduleModule.forRoot()` is imported for `SchedulerRegistry`, as `BacklogSyncModule` and
 * `ProviderHealthModule` do; the call is idempotent, so three modules asking for it is one
 * registry.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { DbModule } from "../db/db.module";
import { EngineModule } from "../engine/engine.module";
import { RoutingModule } from "../routing/routing.module";
import { EstimationContextService } from "./estimation.context";
import { EstimationController } from "./estimation.controller";
import { EstimationLimiter } from "./estimation.limiter";
import { EstimationOrchestrator } from "./estimation.orchestrator";
import { EstimationRepository } from "./estimation.repository";
import { EstimationSweeper } from "./estimation.sweeper";
import { EstimationTriggerService } from "./estimation.trigger.service";

@Module({
  imports: [DbModule, EngineModule, RoutingModule, ScheduleModule.forRoot()],
  controllers: [EstimationController],
  providers: [
    EstimationOrchestrator,
    EstimationRepository,
    EstimationContextService,
    EstimationSweeper,
    EstimationTriggerService,
    // One limiter per process, for the reason `GithubRateLimiter` is one: a second instance
    // would be a second counter, and a limit of thirty enforced twice is a limit of sixty.
    EstimationLimiter,
  ],
  // The orchestrator alone, still. `BacklogSyncModule` binds `ESTIMATION_INTAKE` to it, and
  // L.4's trigger calls `enqueue()` and `estimating()` on it from inside this module. The
  // repository stays private for the reason every repository in this service does — a consumer
  // reaching past the orchestrator would be a consumer that can claim a row without owning
  // what happens to it next — the sweeper stays private because it is a timer, and the limiter
  // stays private because a counter another module could spend is not a limit.
  exports: [EstimationOrchestrator],
})
export class EstimationModule {}
