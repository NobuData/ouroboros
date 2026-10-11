/**
 * Dry-run orchestration & guards — CD.4
 * ([#562](https://github.com/NobuData/ouroboros/issues/562)).
 *
 * dry-runs.controller.ts      the routes under /workflows/{id}/dry-runs
 * dry-runs.service.ts         the lifecycle: refusals, pin, pre-check, budget, dispatch
 * dry-runs.runner.ts          a run in flight: the harness's stream relayed, recorded, ended
 * dry-runs.records.ts         a dry run read back whole
 * dry-runs.repository.ts      V111's tables and the rows of other planes a run is made from
 * dry-runs.commit.ts          the commit a run pins, and the token it reads with
 * dry-runs.plans.ts           each model stage's alias (Z.1) and knowledge (BF.5)
 * dry-runs.budget.ts          min(workspace cap, the draft's spend guard)
 * dry-runs.picker.ts          decision W8's edge-case scorer, pure
 * dry-runs.picker.service.ts  the scorer over a workspace's tickets
 * dry-runs.safety.ts          the safety strip, derived from the harness's configuration
 * dry-runs.stream.ts          the server-sent events
 * dry-runs.resources.ts       the API shapes
 * dry-runs.dto.ts             the bodies, params and queries
 * dry-runs.errors.ts          the codes
 *
 * Imports `EngineModule` (the pre-check, the harness and its description), `RoutingModule` and
 * `ContextAssemblyModule` (what each model stage is sent), `WorkflowsModule` (the catalogue of
 * names that exist) and `GithubModule` (the pinned commit and the read token).
 *
 * **It exports {@link DryRunPickerService}** and nothing else: the copilot's `lookup_tickets`
 * must rank with the scorer the **Dry-run another issue ▾** menu uses, so `CopilotModule`
 * imports this module for it. This module imports nothing of the copilot's back — a draft's
 * spend guard is read from `copilot_messages` by `dry-runs.repository.ts`.
 */

import { Module } from "@nestjs/common";

import { ContextAssemblyModule } from "../context-assembly/context-assembly.module";
import { DbModule } from "../db/db.module";
import { EngineModule } from "../engine/engine.module";
import { GithubModule } from "../github/github.module";
import { RoutingModule } from "../routing/routing.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { PinnedCommitReader } from "./dry-runs.commit";
import { DryRunsController } from "./dry-runs.controller";
import { DryRunPickerService } from "./dry-runs.picker.service";
import { DryRunPlanService } from "./dry-runs.plans";
import { DryRunRecords } from "./dry-runs.records";
import { DryRunsRepository } from "./dry-runs.repository";
import { DryRunRunner } from "./dry-runs.runner";
import { DryRunsService } from "./dry-runs.service";

@Module({
  imports: [
    DbModule,
    EngineModule,
    RoutingModule,
    ContextAssemblyModule,
    WorkflowsModule,
    GithubModule,
  ],
  controllers: [DryRunsController],
  providers: [
    DryRunsService,
    DryRunRunner,
    DryRunRecords,
    DryRunsRepository,
    DryRunPlanService,
    DryRunPickerService,
    PinnedCommitReader,
  ],
  exports: [DryRunPickerService],
})
export class DryRunsModule {}
