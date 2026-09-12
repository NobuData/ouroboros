/**
 * The workflow registry — *which workflows does this workspace have?* (P.4,
 * [#135](https://github.com/NobuData/ouroboros/issues/135), absorbing
 * [#124](https://github.com/NobuData/ouroboros/issues/124)).
 *
 * **The amendment carried in from the intake roadmap.** Mockup 03 has two surfaces that name
 * a workflow — the selection bar's *Assign workflow ▾*
 * ([#118](https://github.com/NobuData/ouroboros/issues/118)) and the estimate request's
 * offered vocabulary ([#107](https://github.com/NobuData/ouroboros/issues/107)) — and both
 * were built against decision **K5**'s fixed set of four tags, because workflow entities did
 * not exist. V029 created them and this is where the two surfaces start reading them:
 *
 * > *assign-workflow menus and the estimator's workflow context read from this registry
 * > rather than the fixed built-in tag set of intake decision K5. Stored opaque tags keep
 * > resolving, because they are slugs.*
 *
 * That last sentence is the compatibility guarantee, and it is V029's rather than this
 * service's: `runs.workflow_tag` and `queue_items.workflow_tag` are still opaque text by
 * decision **F8**, no foreign key was added, and `workflows.slug` is bounded to exactly what
 * a tag can hold. So every tag already stored is still a slug, every stored row still renders,
 * and what changes here is only *what a new write may name*.
 *
 * ---------------------------------------------------------------------------
 * ## Active only
 *
 * `paused` and `archived` are both off this vocabulary, for different reasons and to the same
 * end. A paused workflow is on the rail — it is the mockup's `hotfix-p0`, err-dot and all —
 * and offering it would be offering to queue work onto something the workspace has switched
 * off. An archived one is V029's soft delete and is off the rail too. Neither refusal touches
 * history: a queue row or a run that already names either keeps rendering, because the tag is
 * opaque.
 *
 * ## The bootstrap vocabulary, and why it is not a fabrication
 *
 * A workspace with no workflow rows has an **empty** registry, and that is the ordinary state
 * of every installation today: V029's tables have no writer at all — P.3
 * ([#134](https://github.com/NobuData/ouroboros/issues/134)) is the create and #136 is the
 * seed, and neither has landed. Serving an empty vocabulary would not be honest, it would be
 * broken: `issue_estimates.suggested_workflow` is `not null`, the engine refuses an estimate
 * naming anything outside the offered set, and a bulk queue names a workflow or falls back to
 * each issue's own suggestion — so an empty set takes a *shipped and working* intake pipeline
 * offline for every workspace, in exchange for a purity nobody asked P.4 to buy.
 *
 * So a workspace with no workflows is offered {@link BOOTSTRAP_WORKFLOW_SLUGS} — the four
 * decision **K5** named, which are the four the bundled estimator classifies into and the four
 * mockup 03 renders. The distinction the honesty rule actually cares about is preserved and
 * published: {@link OfferedWorkflows.source} says which of the two answers a caller got, so
 * *"the assign menu lists registry workflows"* is a statement a test can make about a
 * workspace that has some, rather than one nobody can check.
 *
 * **It is not a default merged into the registry.** A workspace with one workflow is offered
 * that one and nothing else — the built-ins do not linger beside it, because a menu offering
 * `docs-loop` to a workspace that deleted it is the dishonesty this ticket is about. The
 * fallback applies to the empty registry and to no other case, and it disappears the moment a
 * workspace has a workflow.
 */

import { Injectable, Logger } from "@nestjs/common";

import { WorkflowStatsRepository } from "./stats.repository";

/**
 * The workflows a workspace with none of its own is offered — decision **K5**'s four.
 *
 * Moved here from `estimation/estimation.context.ts`, which predicted the move in as many
 * words: *"`WORKFLOW_TAGS` is a list in this file because there is nowhere else for it to be
 * yet … when mockup 04's catalog lands it replaces this constant"*. This is that catalog, and
 * the constant it kept is now the catalog's empty-registry answer.
 *
 * `standard-fix` is first deliberately, and that has not changed: it is the tag the bundled
 * estimator falls back to *by name*, so a reader should not have to check that the list
 * happens to contain it.
 */
export const BOOTSTRAP_WORKFLOW_SLUGS = Object.freeze([
  "standard-fix",
  "docs-loop",
  "feature-loop",
  "deps-refresh",
] as const);

/** Where an offered vocabulary came from. */
export type OfferedWorkflowSource = "registry" | "bootstrap";

/** The workflows a workspace may name, and where the list came from. */
export interface OfferedWorkflows {
  /**
   * The slugs, in the registry's own order — which is the order the workflows were created,
   * and therefore the order the rail lists them.
   *
   * Never empty: see this file's header on the bootstrap vocabulary.
   */
  readonly slugs: readonly string[];
  /**
   * `registry` when the workspace has workflows of its own, `bootstrap` when it has none.
   *
   * Published rather than kept private because it is the difference between *"these are your
   * workflows"* and *"you have none, so here are the built-ins"* — and a caller that needs to
   * say which (a test, a log line, an eventual empty-state in the UI) should not have to
   * compare the list against a constant to find out.
   */
  readonly source: OfferedWorkflowSource;
}

@Injectable()
export class WorkflowRegistryService {
  /**
   * Where the bootstrap fallback is reported.
   *
   * `debug` rather than `warn`, which is the opposite of `EstimationContextService`'s choice
   * about its own fallback and deliberately so: a workspace that routes no models cannot be
   * estimated at all and somebody has to be told, while a workspace with no workflow entities
   * is simply an installation on which P.3 has not landed yet. It is on the path of every
   * queue write and every estimate, so a `warn` would be a line per request saying nothing
   * had gone wrong.
   */
  private readonly logger = new Logger(WorkflowRegistryService.name);

  /**
   * @param repository - The org-scoped statements. Only `activeSlugs` is used from here; the
   *   rail's own read is `WorkflowStatsService`'s.
   */
  constructor(private readonly repository: WorkflowStatsRepository) {}

  /**
   * The workflows one workspace may name.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns Its active workflows' slugs, or {@link BOOTSTRAP_WORKFLOW_SLUGS} when it has
   *   none. Never empty, so a caller never has to decide what an empty vocabulary means.
   *
   *   `slugs` is `readonly`, and in the fallback case it is the module constant itself —
   *   frozen, so a caller that ignored the type and pushed onto it would throw rather than
   *   silently give every other workspace a fifth built-in for the life of the process.
   */
  async offered(organizationId: string): Promise<OfferedWorkflows> {
    const slugs = await this.repository.activeSlugs(organizationId);

    if (slugs.length > 0) return { slugs, source: "registry" };

    this.logger.debug(
      `Workspace ${organizationId} has no active workflows, so the built-in vocabulary ` +
        `(${BOOTSTRAP_WORKFLOW_SLUGS.join(", ")}) is what it is offered. Creating one ` +
        "replaces the whole list — see registry.service.ts.",
    );

    return { slugs: BOOTSTRAP_WORKFLOW_SLUGS, source: "bootstrap" };
  }

  /**
   * Whether a workspace may queue work under one named workflow.
   *
   * A membership test rather than a filter the caller applies, so that *offered* and
   * *accepted* are one question: a menu that lists a slug this refuses, or refuses one it
   * lists, would be a `422` a person cannot act on.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param slug - What the request named.
   * @returns Whether it is one of {@link offered}'s slugs.
   */
  async accepts(organizationId: string, slug: string): Promise<boolean> {
    const { slugs } = await this.offered(organizationId);

    return slugs.includes(slug);
  }
}
