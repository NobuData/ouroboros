/**
 * Route resolution — the one pure, versioned function behind simulation today and execution
 * tomorrow ([#194](https://github.com/NobuData/ouroboros/issues/194), decision **M6**).
 *
 * ```
 * context.ts               the ctx half of resolve(taskKind, ctx), and the predicate over it
 * locality.ts              which provider kinds count as local, borrowed from the lease policy
 * explanations.ts          every code, and the sentence beside it
 * inputs.ts                what resolve() is given — six values, none of them a client
 * resolution.ts            what it answers with, and the version a consumer pins
 * rules.ts                 M5: what a rule is, and what applying one does to a chain
 * resolve.ts               the function
 * routing.rows.ts          rows in, inputs out
 * routing.repository.ts    four reads and no writes
 * routing.errors.ts        the one refusal that is not an answer
 * resolution.service.ts    the load, and then the pure function
 * ```
 *
 * **It exports its service and declares no controller**, which is the shape of the ticket
 * rather than an omission. Z.1 is the *engine*; the HTTP surface over it is Z.4's
 * (`/routing/simulate`, [#197](https://github.com/NobuData/ouroboros/issues/197)) and the
 * management API is Z.2's ([#195](https://github.com/NobuData/ouroboros/issues/195)). A route
 * added here would be this module answering a question two other tickets own the shape of.
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
import { ResolutionService } from "./resolution.service";
import { RoutingRepository } from "./routing.repository";

@Module({
  imports: [DbModule, ProviderHealthModule],
  providers: [ResolutionService, RoutingRepository],
  // The one export, and the internal contract Z.4 (#197), AB.5 (#211) and CH.6 (#589) were
  // all told to consume. The repository stays private: a consumer reaching past the service
  // would be a consumer holding rows instead of a resolution, and rows carry no explanations.
  exports: [ResolutionService],
})
export class RoutingModule {}
