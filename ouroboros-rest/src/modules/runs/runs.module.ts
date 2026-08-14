/**
 * Runs — the paged read API over the V008 read-model
 * ([#71](https://github.com/NobuData/ouroboros/issues/71)).
 *
 * The same three layers as everywhere, at the drill-in's size:
 *
 * ```
 * controller  the routes, the request shapes       → runs.controller.ts
 * service     the page, the 404, the shared mapper → runs.service.ts
 * repository  the statements, and nothing else     → runs.repository.ts
 * ```
 *
 * A module of its own rather than more controllers in `DashboardModule`, which is that
 * module's stated design: the dashboard exports nothing so its card-sized limits and window
 * choices stay its own, and the drill-ins publish their own statements over the same rows.
 * What *is* shared is the one thing the ticket requires to be — `RunSummary` and its mapper,
 * imported from `dashboard/resources.ts` as pure code, so a run row has exactly one shape
 * on the aggregate and on these pages.
 *
 * It imports `DbModule` for the reason every module with a repository does: the import is
 * the answer to "who can reach the runs read-model", and `DbModule` is deliberately
 * non-global so the question has one.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { RunsController } from "./runs.controller";
import { RunsRepository } from "./runs.repository";
import { RunsService } from "./runs.service";

@Module({
  imports: [DbModule],
  controllers: [RunsController],
  providers: [RunsService, RunsRepository],
  // Nothing is exported, for the dashboard module's own reason: the routes are the surface,
  // and the queue (#73) and settings (#74) drill-ins publish their own.
})
export class RunsModule {}
