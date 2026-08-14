/**
 * The dashboard — mockup 02's six card surfaces as one org-scoped payload
 * ([#70](https://github.com/NobuData/ouroboros/issues/70)).
 *
 * The same three layers every module here has, and the seams matter more than usual because
 * of what sits on each one:
 *
 * ```
 * controller  the route, the conditional request, nothing else  → dashboard.controller.ts
 * service     the windows, the tag, the assembly                → dashboard.service.ts
 * repository  the statements, and nothing else                  → dashboard.repository.ts
 * ```
 *
 * Two files sit beside them rather than inside any of the three, because what they hold is
 * decided once and read from several places: `windows.ts` is every instant a number is
 * measured between, and `etag.ts` is the tag's encoding and the comparison that answers
 * `304`. `resources.ts` is the row → resource mapper, and is also where the *definition* of
 * each aggregate is written down — a number whose definition lives only in a SQL predicate
 * is a number a screen will eventually render under the wrong label.
 *
 * It imports `DbModule` for the reason every module with a repository does: the import is
 * the answer to "who can reach the dashboard read-model", and `DbModule` is deliberately
 * non-global so the question has one.
 *
 * **What it deliberately is not.** It is not the runs API — #71 publishes the paged listings
 * the *Open run console →* and *All issues →* links lead to, and takes `RunSummary` with it
 * so the aggregate's slices and those pages are one shape. It is not the queue's writer
 * (#73), and it is not the auto-merge switch's (#74): this module answers with the switch's
 * position and writes nothing at all. Every statement it issues is a `select`.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardRepository } from "./dashboard.repository";
import { DashboardService } from "./dashboard.service";

@Module({
  imports: [DbModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardRepository],
  // Nothing is exported. #71, #73 and #74 publish their own endpoints over the same rows
  // rather than reaching through this module — a shared service would make the dashboard's
  // card-sized limits and window choices theirs too, and they are not.
})
export class DashboardModule {}
