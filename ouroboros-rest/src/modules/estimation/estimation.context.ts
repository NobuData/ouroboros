/**
 * The vocabularies an estimate may use — the workflow tags that exist, and the models routing
 * resolves.
 *
 * L.3 ([#107](https://github.com/NobuData/ouroboros/issues/107)), and **the unlanded half of
 * the Z.4 routing amendment** ([#197](https://github.com/NobuData/ouroboros/issues/197),
 * decision **M6**). That amendment split in two: the engine's half landed with L.2
 * ([#106](https://github.com/NobuData/ouroboros/issues/106)) — `heuristic-v0` holds no
 * configuration map, reads the caller's `model_defaults`, and says *resolved, not invoked* in
 * its own trace — and this is the other half: **filling that map from the routing resolution
 * rather than from configuration.**
 *
 * ---------------------------------------------------------------------------
 * ## Why the engine is told rather than asked
 *
 * Decisions **K5** and **K6**: a workflow tag and a routed model are opaque strings the engine
 * ascribes no meaning to, and the set of them belongs to *this* installation. So they travel
 * with every request, and an estimate naming anything outside them is refused inside the engine
 * before it is answered — which is why nothing downstream re-checks the answer.
 *
 * ## The models come from `ResolutionService`, which is the simulate endpoint's own code
 *
 * `POST /api/v1/routing/simulate` serves `ResolutionService.resolve()` unchanged, and so does
 * this. There is no second answer to *which model runs this* for the two to drift apart into:
 * the value in the map is the resolved chain's primary — the first hop the executor would
 * actually try — and an estimate's `routed_model` is therefore a model this workspace really
 * routes to rather than a string somebody wrote in a file.
 *
 * **Resolved, never invoked.** Nothing here calls a model. `routed_model`'s own column comment
 * says the same thing from the other side: *"this records a resolution that happened, and a
 * record must survive the rename or retirement of what it names"*.
 *
 * ## A workspace whose routing resolves nothing is not dispatched
 *
 * `issue_estimates.routed_model` is `not null` and non-blank. So an installation with no route
 * — the ordinary state of a fresh workspace, because seeding default routes has no service yet
 * ([#205](https://github.com/NobuData/ouroboros/issues/205)) — genuinely has no estimate to
 * store, and the honest thing is to say so once and leave its issues `unsized`. It is
 * deliberately **not** `needs_human`: that status means *this issue wants a person to size it*,
 * and burning a whole backlog into it for a reason that has nothing to do with any of the
 * issues would be the page telling a story about the wrong thing. `unsized` is what those rows
 * already are, it is what L.4's re-estimate and AL.5's nightly job
 * ([#281](https://github.com/NobuData/ouroboros/issues/281)) both act on, and configuring a
 * route is what changes it.
 *
 * ## What is a constant here, and why that is not a shrug
 *
 * {@link WORKFLOW_TAGS} is a list in this file because there is nowhere else for it to be
 * yet: workflow *entities* are mockup 04's, no migration declares one, and `runs.workflow_tag`
 * is opaque text by decision **F8** precisely so that a vocabulary can arrive later. The four
 * below are the four the bundled estimator classifies into and the four mockup 03 renders, so
 * this constant is the same claim the rest of the system already makes — written down once,
 * where the request is built, rather than implied in four places. When mockup 04's catalog
 * lands it replaces this constant and nothing else in this module changes.
 */

import { Injectable, Logger } from "@nestjs/common";

import type { EstimationContext } from "../engine/engine.contract";
import { ResolutionService } from "../routing/resolution.service";

/**
 * Every workflow tag this installation has.
 *
 * The four the mockup's backlog table renders and the four `heuristic-v0` classifies into. The
 * engine only ever *prefers* one of them — `estimation/heuristic.py`'s `offered_tag` falls back
 * through `standard-fix` to whatever was offered first — so this list is what an answer is held
 * to rather than a hint.
 *
 * `standard-fix` is first deliberately: it is the fallback the estimator reaches for by name,
 * and a reader should not have to check that the list happens to contain it.
 */
export const WORKFLOW_TAGS = ["standard-fix", "docs-loop", "feature-loop", "deps-refresh"] as const;

/**
 * The `model_defaults` keys this service offers, and the task kind each resolves through.
 *
 * The keys are the *caller's own naming* — the engine says so, and looks them up
 * case-insensitively against a per-tag preference list before falling back to `default`. These
 * two are the ones that pay for themselves:
 *
 *   * **`default`** is the key every classification falls through to, so it is the one key that
 *     must exist for a map to be useful at all. `implement` is the kind behind it because
 *     `routed_model` is which model should *do the work*, and doing the work is what
 *     `implement` routes.
 *   * **`docs`** is what the engine looks up first for a `docs-loop` issue, and `docs` is a
 *     task kind in its own right with a route of its own — which is exactly the case where a
 *     workspace has said *documentation runs somewhere cheaper* and this map is how it gets
 *     honoured.
 *
 * A kind with no route contributes no key rather than a guessed one; see
 * {@link EstimationContextService.forWorkspace}. Adding a key is adding a line here **and** a
 * task kind a workspace actually has — a key that resolves through a kind nobody routes would
 * be an entry that silently never appears.
 */
export const MODEL_DEFAULT_KINDS: Readonly<Record<string, string>> = Object.freeze({
  default: "implement",
  docs: "docs",
});

@Injectable()
export class EstimationContextService {
  /** Where a workspace that cannot be routed is reported. Once per workspace per attempt. */
  private readonly logger = new Logger(EstimationContextService.name);

  /**
   * @param routing - Z.1's resolution, exported by `RoutingModule` as its one public contract.
   *   The same method `POST /api/v1/routing/simulate` serves, which is the whole point — see
   *   this file's header.
   */
  constructor(private readonly routing: ResolutionService) {}

  /**
   * The vocabularies one workspace's estimates may use.
   *
   * The resolutions are issued together: they are independent questions about unrelated task
   * kinds, and a `Promise.all` is what keeps building a request one round trip deep rather than
   * one per key.
   *
   * @param organizationId - The workspace. Every resolution is scoped to it, so two workspaces
   *   with different routes get different maps for the same issue.
   * @returns The context to send, or `undefined` when nothing resolved — which means this
   *   workspace has no routing configured and therefore no model an estimate could name. The
   *   caller does not dispatch; see this file's header on why that is not `needs_human`.
   */
  async forWorkspace(organizationId: string): Promise<EstimationContext | undefined> {
    const wanted = Object.entries(MODEL_DEFAULT_KINDS);

    const resolved = await Promise.all(
      wanted.map(async ([key, taskKind]) => ({
        key,
        model: await this.primaryModel(organizationId, taskKind),
      })),
    );

    const modelDefaults = Object.fromEntries(
      resolved
        .filter((entry): entry is { key: string; model: string } => entry.model !== undefined)
        .map((entry) => [entry.key, entry.model]),
    );

    if (Object.keys(modelDefaults).length === 0) {
      this.logger.warn(
        `Workspace ${organizationId} routes none of ` +
          `${wanted.map(([, taskKind]) => taskKind).join(", ")}, so there is no model an ` +
          "estimate could name. Its issues stay `unsized` until a route exists — " +
          "issue_estimates.routed_model is not null, and a guessed model would be a record " +
          "of a resolution that never happened.",
      );

      return undefined;
    }

    return { workflowTags: [...WORKFLOW_TAGS], modelDefaults };
  }

  /**
   * The model the executor would try first for one task kind.
   *
   * @param organizationId - The workspace.
   * @param taskKind - A `task_kinds.name` — `implement`, `docs`.
   * @returns The first **kept** hop's resolved model id, or `undefined` when the workspace has
   *   no route for the kind, when the resolution refused to run one (`fail_run` — a floor
   *   breached, a chain with nothing healthy under it), or when every hop was dropped. All
   *   four are the same answer to this question: there is no model to name.
   *
   *   The *kept* filter is deliberate. `Resolution.chain` carries dropped hops **with their
   *   explanations**, which is what the simulate panel renders; a caller that wanted the
   *   survivors was always meant to apply this filter, and naming a hop the executor would
   *   skip would be an estimate pointing at a model that is not going to run.
   */
  private async primaryModel(
    organizationId: string,
    taskKind: string,
  ): Promise<string | undefined> {
    try {
      const resolution = await this.routing.resolve(organizationId, taskKind);

      if (resolution.outcome !== "resolved") {
        return undefined;
      }

      return resolution.chain.find((hop) => hop.decision === "kept")?.modelId;
    } catch {
      // `route_not_found` is the expected shape of "this workspace has no route for that kind",
      // and it is a `NotFoundError` rather than an answer because a request asking about a
      // missing route deserves a 404. Here it is ordinary, and so is anything else this read
      // can fail with: the caller's next move is the same in every case, and the sentence a
      // person needs is logged once per workspace by `forWorkspace` rather than once per key.
      return undefined;
    }
  }
}
