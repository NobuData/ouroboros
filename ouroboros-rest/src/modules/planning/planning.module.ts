/**
 * `PlanningModule` — mockup 09's server side.
 *
 * AL.3 ([#279](https://github.com/NobuData/ouroboros/issues/279)) brought the module in with
 * `PushService`, which writes a batch's drafts into a tracker through the ticket-source SPI and
 * nothing else: it reaches a provider through `TicketSourceRegistry` and opens a credential through
 * `TicketSourcesService`, both exported by `TicketSourcesModule`, and imports no provider —
 * `.dependency-cruiser.cjs`'s `ticket-source-core-imports-the-spi-only` fails the build if it
 * does, and `ticket-sources/boundary.spec.ts` watches that rule fail on this very path.
 *
 * AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280)) adds the routes — batches, drafts,
 * push, epics, roadmap, milestones — and composes three other modules rather than duplicating them:
 *
 *   * `EngineModule` — AL.1's `/v0/plan`, the planner.
 *   * `EstimationModule` — INTAKE-L.3's `EstimationOrchestrator`, **the one sizer** (decision N3).
 *     This module provides no estimator of its own, and `planning.module.spec.ts` asserts it.
 *   * `BacklogModule` — INTAKE-M.3's `BacklogQueueService`, the queue write the `queue_small` hook
 *     composes (decision N7).
 */

import { Module } from "@nestjs/common";

import { BacklogModule } from "../backlog/backlog.module";
import { DbModule } from "../db/db.module";
import { EngineModule } from "../engine/engine.module";
import { EstimationModule } from "../estimation/estimation.module";
import { TicketSourcesModule } from "../ticket-sources/ticket-sources.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { BatchesController } from "./batches.controller";
import { BatchesService } from "./batches.service";
import { EpicsService } from "./epics.service";
import { PlanningController } from "./planning.controller";
import { PlanningRepository } from "./planning.repository";
import { PushRepository } from "./push.repository";
import { PushService } from "./push.service";
import { QueueSmallHook } from "./queue-small";

@Module({
  imports: [
    DbModule,
    TicketSourcesModule,
    EngineModule,
    EstimationModule,
    BacklogModule,
    WorkflowsModule,
  ],
  controllers: [BatchesController, PlanningController],
  providers: [
    PushService,
    PushRepository,
    PlanningRepository,
    BatchesService,
    EpicsService,
    QueueSmallHook,
  ],
  exports: [PushService],
})
export class PlanningModule {}
