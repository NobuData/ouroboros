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
 * ## The tags come from the workflow registry, and they used to be a constant here
 *
 * They were a list in this file while there was nowhere else for them to be — workflow
 * *entities* were mockup 04's, no migration declared one, and `runs.workflow_tag` is opaque
 * text by decision **F8** precisely so that a vocabulary could arrive later. This file
 * predicted the move in as many words: *"when mockup 04's catalog lands it replaces this
 * constant and nothing else in this module changes."*
 *
 * It has landed. V029 created `workflows`, and P.4
 * ([#135](https://github.com/NobuData/ouroboros/issues/135)) is the registry over it — so
 * `workflowTags` is now **this workspace's** active workflows rather than four names every
 * installation shared, which is the amendment absorbed from
 * [#124](https://github.com/NobuData/ouroboros/issues/124). Nothing else in this module
 * changed, and the constant did not disappear: a workspace with no workflows of its own is
 * still offered decision **K5**'s four, as `workflows/registry.service.ts`'
 * `BOOTSTRAP_WORKFLOW_SLUGS`, and that file is where the reasoning for the fallback lives.
 *
 * **The set is still what an answer is held to.** The engine refuses an estimate naming
 * anything outside the offered tags before answering, which is why nothing downstream
 * re-checks the answer — and it is why a workspace's own vocabulary reaching the engine is the
 * whole of what this amendment had to do.
 *
 * ## The one bound a registry brings that a constant did not
 *
 * `EstimationContext.workflow_tags` is capped at {@link MAX_OFFERED_WORKFLOW_TAGS} by the
 * engine's own contract (`estimation/contract.py`'s `MAX_WORKFLOW_TAGS`), and it is a *refusal*
 * there rather than a truncation: a longer list is a `422` and no estimate at all. Four names
 * in a constant could never reach it; a workspace's registry can. So the list is cut here —
 * keeping the rail's own order, which is the order the workflows were created, so that adding
 * one does not change which sixty-four are offered — because the trade is between an estimate
 * that cannot suggest the workspace's sixty-fifth workflow and no estimate for that workspace
 * whatsoever. It is logged when it happens, since it means the two bounds need reconciling
 * rather than that anything is wrong with the request.
 *
 * Slug *length* needs no such care: `workflows_slug_format` holds a slug to 64 characters,
 * which is exactly the engine's `MAX_TAG_LENGTH`.
 */

import { Injectable, Logger } from "@nestjs/common";

import type { EstimationContext } from "../engine/engine.contract";
import { ResolutionService } from "../routing/resolution.service";
import { WorkflowRegistryService } from "../workflows/registry.service";

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

/**
 * How many workflow tags one estimate request may offer.
 *
 * `MAX_WORKFLOW_TAGS` in `ouroboros-engine`'s `estimation/contract.py`, mirrored — the engine
 * refuses a longer list outright, so the number has to be known on this side of the call. See
 * this file's header on why a list this long is truncated rather than sent.
 */
export const MAX_OFFERED_WORKFLOW_TAGS = 64;

@Injectable()
export class EstimationContextService {
  /**
   * Where a workspace that cannot be routed is reported, and where a registry longer than the
   * engine's contract accepts is. Once per workspace per attempt, either way.
   */
  private readonly logger = new Logger(EstimationContextService.name);

  /**
   * @param routing - Z.1's resolution, exported by `RoutingModule` as its one public contract.
   *   The same method `POST /api/v1/routing/simulate` serves, which is the whole point — see
   *   this file's header.
   * @param workflows - P.4's registry, exported by `WorkflowsModule`. The same vocabulary a
   *   bulk queue write is validated against, for the same reason the models come from
   *   `ResolutionService`: one answer to *which workflows does this workspace have*, so the
   *   assign menu and the estimator's offered tags cannot disagree.
   */
  constructor(
    private readonly routing: ResolutionService,
    private readonly workflows: WorkflowRegistryService,
  ) {}

  /**
   * The vocabularies one workspace's estimates may use.
   *
   * Every read is issued together: the two resolutions and the registry are independent
   * questions about unrelated tables, and a `Promise.all` is what keeps building a request one
   * round trip deep rather than one per answer.
   *
   * @param organizationId - The workspace. Every read is scoped to it, so two workspaces with
   *   different routes and different workflows get different vocabularies for the same issue.
   * @returns The context to send, or `undefined` when no model resolved — which means this
   *   workspace has no routing configured and therefore no model an estimate could name. The
   *   caller does not dispatch; see this file's header on why that is not `needs_human`. An
   *   empty *workflow* registry is deliberately not the same kind of answer: it has one, and
   *   `workflows/registry.service.ts` gives it.
   */
  async forWorkspace(organizationId: string): Promise<EstimationContext | undefined> {
    const wanted = Object.entries(MODEL_DEFAULT_KINDS);

    const [resolved, offered] = await Promise.all([
      Promise.all(
        wanted.map(async ([key, taskKind]) => ({
          key,
          model: await this.primaryModel(organizationId, taskKind),
        })),
      ),
      this.workflows.offered(organizationId),
    ]);

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

    return { workflowTags: this.withinEngineBound(organizationId, offered.slugs), modelDefaults };
  }

  /**
   * The offered tags, cut to what the engine's contract will accept.
   *
   * @param organizationId - The workspace, for the log line.
   * @param slugs - What the registry offered, in the rail's order.
   * @returns A copy — never the registry's own array, so nothing downstream can edit its
   *   answer — holding at most {@link MAX_OFFERED_WORKFLOW_TAGS} of them.
   */
  private withinEngineBound(organizationId: string, slugs: readonly string[]): string[] {
    if (slugs.length <= MAX_OFFERED_WORKFLOW_TAGS) {
      return [...slugs];
    }

    this.logger.warn(
      `Workspace ${organizationId} has ${slugs.length} active workflows and the engine's ` +
        `estimation contract accepts ${MAX_OFFERED_WORKFLOW_TAGS} tags, so the ` +
        `${slugs.length - MAX_OFFERED_WORKFLOW_TAGS} most recently created cannot be ` +
        "suggested by an estimate. The rail's own order is kept rather than reversed, so which " +
        "tags are offered does not change when a workflow is added; sending the whole list " +
        "would be refused and leave these issues `unsized`, and raising MAX_WORKFLOW_TAGS in " +
        "ouroboros-engine is what removes the cut.",
    );

    return slugs.slice(0, MAX_OFFERED_WORKFLOW_TAGS);
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
