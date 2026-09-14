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
 * code.projection      a document as the code view's text, only when the text reads back as it · #167
 * code.config          ouroboros.config.ts — the registry, printed read-only
 * code.diagnostics     parse errors, findings and references as one ranged stream, via the span map · #178
 * code.checks          the Loop Checks rows, derived from that stream — no infra row (C7)
 * code.resources       the code view's wire shapes: a workflow's file, its checks, the explorer, the config
 * code.service         WorkflowCodeService — read, checks, save through the draft guard, tree, config
 * workflows.controller the lifecycle's routes and the code view's
 * catalog.schema       the published DSL schema, read as per-type config schemas               · #145
 * catalog.presentation the mockup's glyphs and classes, and what a dropped node contains
 * catalog.repository   the workspace's task kinds, for the task-route suggestions
 * catalog.resources    the catalog's wire shapes, and the suggestions as a P7 catalogue
 * catalog.service      WorkflowCatalogService — the node types built once, suggestions per request
 * trigger.evaluation   which workflow claims a queued ticket, as pure functions                · #143
 * trigger.repository   the workspace's workflows with the trigger of the version in force
 * trigger.service      TriggerService — the pin a queue write stores on each item
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
 * **It exports three services**, in `PricingModule`'s pattern and for its reason — the second
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
 *   * {@link TriggerService} is R.1 ([#143](https://github.com/NobuData/ouroboros/issues/143)):
 *     which workflow claims each ticket `BacklogModule`'s queue write is about to store, and the
 *     version it is pinned at. It lives here because a trigger is part of a workflow's published
 *     definition, and evaluating one is this module's language.
 *
 * The repositories stay private. A consumer that reached past the services would be a consumer
 * that had skipped the honesty rules — the captions, the null share, the bootstrap vocabulary,
 * the draft guard — which are the whole of what those files are.
 *
 * **`DbModule` is imported for the reason every module with a repository imports it**: the
 * import is the answer to *who can reach `workflows`, `workflow_versions` and `runs`*, and
 * `DbModule` is deliberately non-global so the question has one.
 *
 * **The published DSL schema is a provider** (R.3,
 * [#145](https://github.com/NobuData/ouroboros/issues/145)), read once by a factory so the
 * process fails at boot, naming the path, when a build forgot to ship it — and so a suite can
 * hand `WorkflowCatalogService` a schema with a synthetic node type instead.
 *
 * The `dsl.*` files are deliberately **not** providers. They are pure functions over a
 * document — `validateWorkflowDocument` and the YAML projection — and a caller imports the
 * function rather than injecting a class, exactly as it did before this module existed.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { EngineModule } from "../engine/engine.module";
import { WorkflowCatalogRepository } from "./catalog.repository";
import { readPublishedDslSchema } from "./catalog.schema";
import { PUBLISHED_DSL_SCHEMA, WorkflowCatalogService } from "./catalog.service";
import { WorkflowCodeService } from "./code.service";
import { WorkflowPublishGate } from "./publish.gate";
import { WorkflowRegistryService } from "./registry.service";
import { WorkflowStatsRepository } from "./stats.repository";
import { WorkflowStatsService } from "./stats.service";
import { TriggerRepository } from "./trigger.repository";
import { TriggerService } from "./trigger.service";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowsRepository } from "./workflows.repository";
import { WorkflowsService } from "./workflows.service";

@Module({
  imports: [DbModule, EngineModule],
  controllers: [WorkflowsController],
  providers: [
    WorkflowsService,
    WorkflowCodeService,
    WorkflowsRepository,
    WorkflowPublishGate,
    WorkflowStatsService,
    WorkflowRegistryService,
    WorkflowStatsRepository,
    WorkflowCatalogService,
    WorkflowCatalogRepository,
    TriggerService,
    TriggerRepository,
    { provide: PUBLISHED_DSL_SCHEMA, useFactory: () => readPublishedDslSchema() },
  ],
  // The three services are exported and the repositories are not, for the reason this file's
  // header gives: a consumer that reached past them would be a consumer that had skipped the
  // honesty rules those services are the whole of.
  exports: [WorkflowStatsService, WorkflowRegistryService, TriggerService],
})
export class WorkflowsModule {}
