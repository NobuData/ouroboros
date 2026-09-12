/**
 * The workflow domain — the DSL, and the registry the rest of the product reads
 * ([#133](https://github.com/NobuData/ouroboros/issues/133),
 * [#135](https://github.com/NobuData/ouroboros/issues/135)).
 *
 * ```
 * dsl.*                the definition language: zod, the structural rules, the YAML projection · #133
 * stats.captions       the rail's captions, as pure functions over facts                      · #135
 * stats.repository     three org-scoped statements over workflows, workflow_versions, runs
 * stats.resources      the shape the studio reads, facts and captions together
 * stats.service        WorkflowStatsService — the rail and the page head, computed per request
 * registry.service     WorkflowRegistryService — which workflows a workspace may name
 * slug                 the identifier a workflow_tag resolves through, and how a title becomes one · #134
 * draft.etag           the conflict guard: what an etag is, and what If-Match may say about it
 * publish.gate         the two validators publishing is behind — zod (P.2), then the engine (R.2)
 * workflows.repository the lifecycle's statements, org-scoped or resolved through one
 * workflows.resources  the wire shapes: summary, draft slot, version, history row
 * workflows.dto        what a request may contain, as class-validator classes
 * workflows.errors     every code this API answers with, and the V029 constraints it translates
 * workflows.service    the rules: the 404, the guard, the gate, the transactions
 * workflows.controller the seven routes
 * ```
 *
 * ---------------------------------------------------------------------------
 * **P.4 is the derivation and P.3 is the surface over it.** This module had no controller
 * until [#134](https://github.com/NobuData/ouroboros/issues/134), and what that ticket added
 * is one: `GET /api/v1/workflows` answers `WorkflowStatsService`'s entries verbatim rather
 * than composing a second listing, which is the failure the export below exists to prevent.
 * There is one derivation of *how many stages does this workflow have*, and the route over it
 * is in the same module as the derivation.
 *
 * **`EngineModule` is imported for the publish gate.** `docs/ARCHITECTURE.md` § 3.2: the UI
 * never calls the engine, this service does — so R.2's second opinion on a definition reaches
 * the studio through `EngineClient`, and the import is the answer to *who may call the engine
 * about a workflow*. `EngineClient` is the only provider it exports, and `publish.gate.ts` is
 * the only thing here that injects it.
 *
 * **It exports two services**, in `PricingModule`'s pattern and for its reason — the second
 * caller is the point:
 *
 *   * {@link WorkflowStatsService} is P.3's rail payload and, through it, S.1's head
 *     ([#147](https://github.com/NobuData/ouroboros/issues/147)). One derivation of *how many
 *     stages does this workflow have*, so the rail caption and the page head cannot disagree.
 *     It is exported as well as used here because #147 reads it through the route and the
 *     estimator's context may yet read it directly.
 *   * {@link WorkflowRegistryService} is the amendment absorbed from
 *     [#124](https://github.com/NobuData/ouroboros/issues/124): the vocabulary
 *     `BacklogModule`'s queue write validates against and `EstimationModule` offers the
 *     engine. Both used to read a constant; both now read a workspace.
 *
 * The repositories stay private. A consumer that reached past the services would be a consumer
 * that had skipped the honesty rules — the captions, the null share, the bootstrap vocabulary,
 * the draft guard — which are the whole of what those files are.
 *
 * **`DbModule` is imported for the reason every module with a repository imports it**: the
 * import is the answer to *who can reach `workflows`, `workflow_versions` and `runs`*, and
 * `DbModule` is deliberately non-global so the question has one.
 *
 * The `dsl.*` files are deliberately **not** providers. They are pure functions over a
 * document — `validateWorkflowDocument` and the YAML projection — and a caller imports the
 * function rather than injecting a class, exactly as it did before this module existed.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { EngineModule } from "../engine/engine.module";
import { WorkflowPublishGate } from "./publish.gate";
import { WorkflowRegistryService } from "./registry.service";
import { WorkflowStatsRepository } from "./stats.repository";
import { WorkflowStatsService } from "./stats.service";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowsRepository } from "./workflows.repository";
import { WorkflowsService } from "./workflows.service";

@Module({
  imports: [DbModule, EngineModule],
  controllers: [WorkflowsController],
  providers: [
    WorkflowsService,
    WorkflowsRepository,
    WorkflowPublishGate,
    WorkflowStatsService,
    WorkflowRegistryService,
    WorkflowStatsRepository,
  ],
  // The two services are exported and the repositories are not, for the reason this file's
  // header gives: a consumer that reached past them would be a consumer that had skipped the
  // honesty rules those services are the whole of.
  exports: [WorkflowStatsService, WorkflowRegistryService],
})
export class WorkflowsModule {}
