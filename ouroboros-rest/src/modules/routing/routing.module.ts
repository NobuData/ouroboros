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
 * **`ResolutionService` is the one export**, unchanged: the editor's service is this module's
 * own controller's dependency and nothing outside reaches it. The controller *is* now
 * declared, which is Z.2 landing rather than Z.1 growing a route — Z.4's `/routing/simulate`
 * ([#197](https://github.com/NobuData/ouroboros/issues/197)) is still somebody else's, and
 * still belongs on the engine side of this file.
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

@Module({
  imports: [DbModule, ProviderHealthModule],
  controllers: [RoutingController],
  providers: [
    ResolutionService,
    RoutingRepository,
    RoutingManagementService,
    RoutingManagementRepository,
  ],
  // The one export, and the internal contract Z.4 (#197), AB.5 (#211) and CH.6 (#589) were
  // all told to consume. Both repositories stay private: a consumer reaching past the service
  // would be a consumer holding rows instead of a resolution, and rows carry no explanations.
  // `RoutingManagementService` stays private for the sharper version of the same reason — it
  // writes, and a module that could inject it could edit another surface's routes.
  exports: [ResolutionService],
})
export class RoutingModule {}
