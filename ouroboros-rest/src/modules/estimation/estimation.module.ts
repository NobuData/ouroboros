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
 * ```
 *
 * **It has no controller, and that is deliberate.** The re-estimation endpoints — the panel's
 * button and the head's *Re-estimate all* — are L.4's
 * ([#108](https://github.com/NobuData/ouroboros/issues/108)); this ticket owns the pipeline
 * those routes will call. {@link EstimationOrchestrator} is exported for exactly that:
 * `enqueue()` is what a `POST /backlog/:id/estimate` does, and `estimating()` is the `409` that
 * ticket answers a double-fire with, read from the queue rather than from a second look at a
 * column that may have moved.
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
import { EstimationOrchestrator } from "./estimation.orchestrator";
import { EstimationRepository } from "./estimation.repository";
import { EstimationSweeper } from "./estimation.sweeper";

@Module({
  imports: [DbModule, EngineModule, RoutingModule, ScheduleModule.forRoot()],
  providers: [
    EstimationOrchestrator,
    EstimationRepository,
    EstimationContextService,
    EstimationSweeper,
  ],
  // The orchestrator alone. `BacklogSyncModule` binds `ESTIMATION_INTAKE` to it, and L.4 will
  // call `enqueue()` and `estimating()` on it. The repository stays private for the reason
  // every repository in this service does — a consumer reaching past the orchestrator would be
  // a consumer that can claim a row without owning what happens to it next — and the sweeper
  // stays private because it is a timer, and a module that could inject it could run somebody
  // else's recovery.
  exports: [EstimationOrchestrator],
})
export class EstimationModule {}
