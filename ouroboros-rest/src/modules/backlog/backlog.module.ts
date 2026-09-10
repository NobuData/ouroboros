/**
 * Backlog — the intake screen's own API surface, opened by M.4
 * ([#113](https://github.com/NobuData/ouroboros/issues/113)).
 *
 * ```
 * debounce.ts             how soon a person may ask for another cycle, and why
 * sync.errors.ts          the two refusals, as codes and messages
 * sync.resources.ts       the three sources → one status, as a pure function
 * sync-status.service.ts  the reads behind it
 * sync-trigger.service.ts the guards, and the one call that starts a cycle
 * backlog.controller.ts   `GET /backlog/sync-status` · `POST /backlog/sync`
 * listing.dto.ts          the filter bar, as a query string (decision K8)
 * listing.search.ts       what one search box matches, and how it is escaped
 * listing.resources.ts    a row, the head's counts and the chip set, as JSON
 * listing.repository.ts   the three statements: rows, counts, facets
 * listing.service.ts      the defaults, and the four concurrent reads
 * listing.controller.ts   `GET /backlog`
 * ```
 *
 * **A module of its own rather than a controller inside `BacklogSyncModule`**, and the reason
 * is what that module already says about itself: *"it has no controller, and that is
 * deliberate"* — it owns a background loop, and it exported `BacklogSyncService` and
 * `BacklogSyncScheduler` **for this**. Keeping the routes out of it preserves the one property
 * the sync module is written around: nothing an HTTP request does can reach inside a cycle.
 *
 * It is also where the rest of Epic M lands, and M.1
 * ([#110](https://github.com/NobuData/ouroboros/issues/110)) is the first of them to arrive:
 * `GET /api/v1/backlog` is `BacklogListingController`, a second controller under the same
 * prefix rather than a second route on the first, because the two answer different questions —
 * one is about the *sync* and one is about the *backlog*, and only the second one grows filters.
 * The issue detail (M.2, [#111](https://github.com/NobuData/ouroboros/issues/111)) and the bulk
 * queue action (M.3, [#112](https://github.com/NobuData/ouroboros/issues/112)) are still this
 * module's controllers to add, which is why the module is named for the surface rather than for
 * any one ticket.
 *
 * **`DbModule` joined the imports with M.1**, because the listing reads `github_issues`
 * and `issue_estimates` directly. It reads them through a repository of this module's own
 * rather than through `BacklogSyncModule` or `EstimationModule`: those two own *writers* — a
 * poll and a versioned insert — and a screen's read has no business entering through either. The
 * tables are the shared surface, and `listing.repository.ts` is this module's view of them.
 *
 * **What it imports is what a status is made of.** `BacklogSyncModule` for the cycle's report,
 * its loop and its statements — all three of that module's exports, and it has no others — and
 * `GithubModule` for *does this workspace have a token* and for the rate guard, which is the
 * same instance the client enforces rather than a second opinion about it. No credential is
 * read here and this module cannot reach one.
 *
 * **Nothing is exported**, for the queue and dashboard modules' reason: the routes are the
 * surface. A second module wanting the freshness stamp should call the endpoint or import
 * `BacklogSyncRepository`, not reach through this one.
 */

import { Module } from "@nestjs/common";

import { BacklogSyncModule } from "../backlog-sync/backlog-sync.module";
import { DbModule } from "../db/db.module";
import { GithubModule } from "../github/github.module";
import { BacklogController } from "./backlog.controller";
import { BacklogListingController } from "./listing.controller";
import { BacklogListingRepository } from "./listing.repository";
import { BacklogListingService } from "./listing.service";
import { SyncStatusService } from "./sync-status.service";
import { SyncTriggerService } from "./sync-trigger.service";

@Module({
  imports: [BacklogSyncModule, DbModule, GithubModule],
  controllers: [BacklogController, BacklogListingController],
  providers: [
    SyncStatusService,
    SyncTriggerService,
    BacklogListingRepository,
    BacklogListingService,
  ],
})
export class BacklogModule {}
