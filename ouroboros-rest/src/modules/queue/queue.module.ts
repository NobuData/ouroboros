/**
 * Queue — the paged read API over the V009 read-model
 * ([#73](https://github.com/NobuData/ouroboros/issues/73)).
 *
 * The same three layers as everywhere, at the drill-in's size:
 *
 * ```
 * controller  the route, the request shape           → queue.controller.ts
 * service     the page, the totals, the shared mapper → queue.service.ts
 * repository  the statements, and nothing else        → queue.repository.ts
 * ```
 *
 * A module of its own rather than more controllers in `DashboardModule`, per the runs
 * module's argument: the dashboard exports nothing so its card-sized limits stay its own,
 * and the drill-ins publish their own statements over the same rows. What *is* shared is
 * the one thing the ticket requires to be — `QueueItemSummary` and its mapper, imported
 * from `dashboard/resources.ts` as pure code, so a queued issue has exactly one shape on
 * the aggregate and on these pages.
 *
 * It imports `DbModule` for the reason every module with a repository does: the import is
 * the answer to "who can reach the queue read-model", and `DbModule` is deliberately
 * non-global so the question has one.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { QueueController } from "./queue.controller";
import { QueueRepository } from "./queue.repository";
import { QueueService } from "./queue.service";

@Module({
  imports: [DbModule],
  controllers: [QueueController],
  providers: [QueueService, QueueRepository],
  // Nothing is exported, for the dashboard module's own reason: the routes are the surface,
  // and the issues screen's queue writes (mockup 03) will publish their own.
})
export class QueueModule {}
