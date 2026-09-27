/**
 * Test-results reads & artifact serving — AT.5
 * ([#333](https://github.com/NobuData/ouroboros/issues/333)).
 *
 * ```
 * controller   /runs/:id/test-runs · /test-runs/:id{,/cases/:caseId/failure} · /artifacts/:id
 * service      the page's shaped reads and the download        → results.service.ts
 * strip        ▲ deltas, T8's activation state, retained Nd     → results.strip.ts (pure)
 * serving      content type, inline or attachment, safe headers → artifact.serving.ts (pure)
 * retention    the hourly sweep that leaves tombstones          → artifact.retention.ts
 * repository   the statements, workspace-scoped                 → results.repository.ts
 * ```
 *
 * Imports `FarmArtifactsModule` for `ARTIFACT_STORE` — the one store the upload writes through is
 * the one this module reads and sweeps. `ScheduleModule.forRoot()` is imported for
 * `SchedulerRegistry`, as `FlakesModule` does. It exports nothing.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { DbModule } from "../db/db.module";
import { FarmArtifactsModule } from "../farm/artifacts/artifacts.module";
import { ArtifactRetentionSweeper } from "./artifact.retention";
import { ResultsController } from "./results.controller";
import { ResultsRepository } from "./results.repository";
import { ResultsService } from "./results.service";

@Module({
  imports: [DbModule, FarmArtifactsModule, ScheduleModule.forRoot()],
  controllers: [ResultsController],
  providers: [ResultsRepository, ResultsService, ArtifactRetentionSweeper],
})
export class TestResultsReadModule {}
