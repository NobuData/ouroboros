/**
 * The run ingestion contract — AP.1
 * ([#303](https://github.com/NobuData/ouroboros/issues/303)), decision **R2**.
 *
 * The same three layers as everywhere:
 *
 * ```
 * controller  the six routes, the request shapes    → ingest.controller.ts
 * service     the five steps, the refusals          → ingest.service.ts
 * repository  the statements, and nothing else      → ingest.repository.ts
 * ```
 *
 * plus three files that are neither: `ingest.transitions.ts` (the R1 state machine),
 * `ingest.pin.ts` (the pinned document, read) and `ingest.idempotency.ts` (what makes two
 * requests one). Each is pure, each has its own suite, and each is the sort of thing that
 * would otherwise become an unexplained branch inside the service.
 *
 * ---------------------------------------------------------------------------
 * **A module of its own rather than more controllers on `InternalModule`.**
 *
 * `InternalModule` is AD.3's surface, and its own docstring opens *"Two routes, and the
 * asymmetry between them is the ticket"*. Six ingestion routes are not that ticket: they
 * answer to the same caller behind the same secret, and they have a repository, a state
 * machine and a substitutable collaborator, which is the shape of a feature module
 * ([#30](https://github.com/NobuData/ouroboros/issues/30)) rather than of two more handlers.
 *
 * What *is* shared stays in `internal/`: the paths (one file, because five things agree about
 * them), the guard, the `@InternalOnly()` metadata and the principal. This module imports all
 * four and registers none of them — `InternalKeyGuard` is an `APP_GUARD` registered by
 * `InternalModule`, so it protects whatever carries `@InternalOnly()` wherever that route
 * lives, and `internal.module.spec.ts` asserts the complement: every route whose *path* is
 * under `/internal` carries the decorator. Neither half can be forgotten quietly, and neither
 * depends on this module being registered in any particular place.
 *
 * ---------------------------------------------------------------------------
 * **It binds `GUARDRAIL_SCHEDULER`, and that binding is the seam AP.3 moves.**
 *
 * A change-set report triggers guardrail evaluation; AP.3
 * ([#305](https://github.com/NobuData/ouroboros/issues/305)) is what answers the four checks.
 * Until then the binding is `PendingGuardrailScheduler`, which writes the four rows as
 * `pending` — V048's word for *"a check that has been scheduled and has not answered"*. AP.3
 * changes this one line; nothing in the service moves, because the trigger point, the
 * transaction and the *"no files, no evaluation"* rule are all AP.1's.
 *
 * **It exports nothing.** Nothing inside this service should be opening runs: the contract
 * exists for a caller outside the process, and a second in-process consumer would be a sign
 * that the read-model had grown a second writer — which is exactly what decision R2 exists to
 * prevent.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { IngestController } from "./ingest.controller";
import { guardrailSchedulerProvider } from "./ingest.guardrails";
import { IngestRepository } from "./ingest.repository";
import { IngestService } from "./ingest.service";

@Module({
  imports: [DbModule],
  controllers: [IngestController],
  providers: [IngestRepository, IngestService, guardrailSchedulerProvider],
})
export class IngestModule {}
