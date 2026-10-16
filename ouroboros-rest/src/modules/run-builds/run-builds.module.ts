/**
 * A run's build stage on the farm, as a module (AJ.3,
 * [#265](https://github.com/NobuData/ouroboros/issues/265)).
 *
 * ```
 * the routes     run-builds.controller.ts   POST /internal/runs/:id/builds · GET …/:jobId · …/cancel
 * the contract   run-builds.service.ts      submit · read · cancel
 * the status     run-builds.status.ts       building ⇄ coding, from the job's completion
 * the rows       run-builds.repository.ts   the run's lock, reservation and the retry chain
 * ```
 *
 * It imports the farm's dispatch module for its one submission path (`FarmJobsService`) and its
 * completion seam (`JobCompletions`), and nothing of the ingest module but plain functions —
 * the epoch fence and the executable-status rule — so neither module has to know the other.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { FarmDispatchModule } from "../farm/dispatch/dispatch.module";
import { RunBuildsController } from "./run-builds.controller";
import { RunBuildsRepository } from "./run-builds.repository";
import { RunBuildsService } from "./run-builds.service";
import { RunBuildStatus } from "./run-builds.status";

@Module({
  imports: [DbModule, FarmDispatchModule],
  controllers: [RunBuildsController],
  providers: [RunBuildsRepository, RunBuildsService, RunBuildStatus],
})
export class RunBuildsModule {}
