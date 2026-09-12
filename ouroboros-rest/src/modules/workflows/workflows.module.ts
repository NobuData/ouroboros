/**
 * The workflow domain — the DSL, and the registry the rest of the product reads
 * ([#133](https://github.com/NobuData/ouroboros/issues/133),
 * [#135](https://github.com/NobuData/ouroboros/issues/135)).
 *
 * ```
 * dsl.*             the definition language: zod, the structural rules, the YAML projection · #133
 * stats.captions    the rail's captions, as pure functions over facts                       · #135
 * stats.repository  three org-scoped statements over workflows, workflow_versions, runs
 * stats.resources   the shape the studio reads, facts and captions together
 * stats.service     WorkflowStatsService — the rail and the page head, computed per request
 * registry.service  WorkflowRegistryService — which workflows a workspace may name
 * ```
 *
 * ---------------------------------------------------------------------------
 * **This module has no controller, and that is not an omission.** P.4 is the *derivation*;
 * every route over it is P.3's ([#134](https://github.com/NobuData/ouroboros/issues/134)) —
 * `GET /api/v1/workflows` is the rail payload, and the roadmap sketches it carrying exactly
 * what {@link WorkflowStatsService} produces. Publishing a second listing here would be two
 * answers to *what is on the rail*, which is the failure the export exists to prevent.
 *
 * **It exports two services, which is why it exists at all**, in `PricingModule`'s pattern and
 * for its reason — the second caller is the point:
 *
 *   * {@link WorkflowStatsService} feeds P.3's rail payload and, through it, S.1's head
 *     ([#147](https://github.com/NobuData/ouroboros/issues/147)). One derivation of *how many
 *     stages does this workflow have*, so the rail caption and the page head cannot disagree.
 *   * {@link WorkflowRegistryService} is the amendment absorbed from
 *     [#124](https://github.com/NobuData/ouroboros/issues/124): the vocabulary
 *     `BacklogModule`'s queue write validates against and `EstimationModule` offers the
 *     engine. Both used to read a constant; both now read a workspace.
 *
 * The repository stays private. A consumer that reached past the services would be a consumer
 * that had skipped the honesty rules — the captions, the null share, the bootstrap vocabulary —
 * which are the whole of what these two files are.
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
import { WorkflowRegistryService } from "./registry.service";
import { WorkflowStatsRepository } from "./stats.repository";
import { WorkflowStatsService } from "./stats.service";

@Module({
  imports: [DbModule],
  providers: [WorkflowStatsService, WorkflowRegistryService, WorkflowStatsRepository],
  exports: [WorkflowStatsService, WorkflowRegistryService],
})
export class WorkflowsModule {}
