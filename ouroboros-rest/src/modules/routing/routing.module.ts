/**
 * Route resolution — the one pure, versioned function behind simulation today and execution
 * tomorrow ([#194](https://github.com/NobuData/ouroboros/issues/194), decision **M6**).
 *
 * ```
 * context.ts                 the ctx half of resolve(taskKind, ctx), and the predicate over it
 * locality.ts                which provider kinds count as local, borrowed from the lease policy
 * explanations.ts            every code, and the sentence beside it
 * inputs.ts                  what resolve() is given — six values, none of them a client
 * resolution.ts              what it answers with, and the version a consumer pins
 * rules.ts                   M5: what a rule is, and what applying one does to a chain
 * resolve.ts                 the function
 * routing.rows.ts            rows in, inputs out
 * routing.repository.ts      four reads and no writes
 * routing.errors.ts          what this module refuses, and the one that is not an answer
 * resolution.service.ts      the load, and then the pure function
 * ```
 *
 * Z.2 ([#195](https://github.com/NobuData/ouroboros/issues/195)) added the editor beside it —
 * decision **M2**'s write surface, which V016 and V018 were both held open for:
 *
 * ```
 * routing.dto.ts             what a management request may contain
 * management.rows.ts         the matrix's rows, and the state a save is compared against
 * management.validation.ts   what a batch is refused for, and which route each refusal is
 * management.diff.ts         what a save changed — what is written, and what is recorded
 * management.repository.ts   the matrix read, and every write
 * resources.ts               rows out, contract out
 * management.service.ts      validate, diff, commit — and the rules card's three writes
 * routing.controller.ts      GET /routing · PUT /routing/routes · the rules · the aliases
 * ```
 *
 * **The engine and the editor are one module and two services**, which is the arrangement
 * worth stating: they read the same four tables, and splitting them would mean two mirrors of
 * V016's chain and two opinions about what an unbound alias is. What they do not share is a
 * repository — `routing.repository.ts` is resolution's four reads and contains no write, and
 * its own spec asserts that, so a write added there fails a test rather than a review.
 *
 * Z.4 ([#197](https://github.com/NobuData/ouroboros/issues/197)) added one route on the engine
 * side, and it is one file because it is one call:
 *
 * ```
 * simulate.dto.ts            what a simulation may ask — {taskKind, ctx}, and nothing else
 * simulate.controller.ts     POST /routing/simulate — one dependency, and no second answer
 * ```
 *
 * Z.5 ([#198](https://github.com/NobuData/ouroboros/issues/198)) added the measurements the
 * matrix's two null columns and the spend card were waiting on — decision **M7**'s half of the
 * page, and five files because a figure about money earns the separation:
 *
 * ```
 * stats.window.ts            the thirty days, computed once so four figures agree
 * stats.repository.ts        two aggregates over token_usage, and no write
 * stats.ts                   rows → the numerics, the meters and the local share
 * stats.cache.ts             the short TTL that keeps a polling page off the ledger
 * stats.service.ts           load, compose, remember — GET /routing and GET /routing/spend
 * ```
 *
 * **`ResolutionService` is the one export**, unchanged: the editor's service is this module's
 * own controller's dependency and nothing outside reaches it. What changed is that the engine
 * now has a controller of its own — `SimulateController` injects the service and nothing else,
 * which is how *"the simulator calls the same code execution will"* is a fact about the
 * dependency graph rather than a sentence in a comment.
 *
 * **`ProviderHealthModule` is imported, and the import is the whole of the pure-inputs rule.**
 * Z.3 exports `ProviderHealthService` for exactly two consumers and this is one of them. The
 * import is a visible statement that health enters resolution *through a service that already
 * has it* rather than through a probe this module performs — and `resolve.ts` never sees the
 * service at all, only the snapshots it returned.
 *
 * `DbModule` is imported for the reason every module with a repository imports it: the import
 * is the answer to "who can reach V016's and V018's tables", and `DbModule` is deliberately
 * non-global so the question has one.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { ProviderHealthModule } from "../provider-health/provider-health.module";
import { RoutingManagementRepository } from "./management.repository";
import { RoutingManagementService } from "./management.service";
import { ResolutionService } from "./resolution.service";
import { RoutingController } from "./routing.controller";
import { RoutingRepository } from "./routing.repository";
import { RoutingStatsCache } from "./stats.cache";
import { RoutingStatsRepository } from "./stats.repository";
import { RoutingStatsService } from "./stats.service";
import { SimulateController } from "./simulate.controller";

@Module({
  imports: [DbModule, ProviderHealthModule],
  controllers: [RoutingController, SimulateController],
  providers: [
    ResolutionService,
    RoutingRepository,
    RoutingManagementService,
    RoutingManagementRepository,
    RoutingStatsService,
    RoutingStatsRepository,
    RoutingStatsCache,
  ],
  // The one export, and the internal contract Z.4 (#197), AB.5 (#211) and CH.6 (#589) were
  // all told to consume. Both repositories stay private: a consumer reaching past the service
  // would be a consumer holding rows instead of a resolution, and rows carry no explanations.
  // `RoutingManagementService` stays private for the sharper version of the same reason — it
  // writes, and a module that could inject it could edit another surface's routes.
  // `RoutingStatsService` stays private too, and that is a decision rather than an oversight:
  // AB.4 (#210) is a UI surface and reads `GET /routing/spend` over HTTP like any other client,
  // so exporting it would only create a second way into the same numbers. `RoutingStatsCache`
  // is a provider rather than a global for the same reason `PricingCache` is — the bound is
  // one map per process, and a module that could inject it could drop another surface's.
  exports: [ResolutionService],
})
export class RoutingModule {}
