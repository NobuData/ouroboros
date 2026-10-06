/**
 * The Get Started wizard, as `ouroboros-rest` serves it (BB.2,
 * [#385](https://github.com/NobuData/ouroboros/issues/385)) — read by `/get-started` (BC.1,
 * [#390](https://github.com/NobuData/ouroboros/issues/390)).
 *
 * **Every step is the service's answer**: the rail's done/active/todo, each done step's result
 * line, each other step's stated reason and whether it regressed are derived on read from the
 * subsystem that owns them. Nothing here or in the screen decides a step.
 *
 * Step 3's tiles and their selection (BB.3, [#386](https://github.com/NobuData/ouroboros/issues/386))
 * ride here too, read by the Get Started template tiles (BC.3,
 * [#392](https://github.com/NobuData/ouroboros/issues/392)): `templates` evaluates every tier's
 * gate against the workspace's merged loops, and `selectTemplate` **creates a real workflow**
 * (decision O4) through the studio's own publish gate — owner or admin.
 *
 * Step 4's safe pick (BB.4, [#387](https://github.com/NobuData/ouroboros/issues/387)) rides here
 * as well, read by the Get Started first-issue card (BC.4,
 * [#393](https://github.com/NobuData/ouroboros/issues/393)): `firstIssue` is the scored pick with
 * its reasoning and the cold states, `firstIssueAlternatives` the safety-ranked backlog behind
 * *or pick your own*, and {@link readFirstIssueCard} is the card's one read — both, with the
 * dry-run policy its safety rows state.
 *
 * Server-side only, by way of `app/api/server.ts`.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import { type DryRunPolicy, dryRunPolicy } from "@/app/api/policies";
import { type Reading, attempt } from "@/app/api/reading";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** One repository's wizard: the rail, the stored choices, card references and the surfacing rule. */
export type Onboarding = components["schemas"]["Onboarding"];

/** One step of the rail. */
export type OnboardingStep = components["schemas"]["OnboardingStep"];

/** Whether to offer the wizard — the fresh-org rule. */
export type OnboardingSurfacing = components["schemas"]["OnboardingSurfacing"];

/** What the import-skip answers. */
export type OnboardingSkip = components["schemas"]["OnboardingSkip"];

/** What *Run my first loop* answers. */
export type OnboardingLaunchReceipt = components["schemas"]["OnboardingLaunchReceipt"];

/** The body of a choices change. */
export type OnboardingPatch = components["schemas"]["OnboardingPatch"];

/** Step 3's tile grid: the tiles, the active choice, and the merged-loop count every gate saw. */
export type OnboardingTemplateTiles = components["schemas"]["OnboardingTemplateTiles"];

/** One tile — a template, its evaluated gate, and the live workflow made from it, if any. */
export type OnboardingTemplateTile = components["schemas"]["OnboardingTemplateTile"];

/** A tier's evaluated gate — `3 of 10 merged loops`, computed by the service. */
export type OnboardingTemplateUnlock = components["schemas"]["OnboardingTemplateUnlock"];

/** A workflow instantiated from a template, with where the studio opens it. */
export type OnboardingInstantiatedWorkflow = components["schemas"]["OnboardingInstantiatedWorkflow"];

/** What selecting a template answers: the workflow behind the choice, the ones kept, the wizard. */
export type OnboardingTemplateSelection = components["schemas"]["OnboardingTemplateSelection"];

/** One finding of the publish gate — what a refused template's definition got wrong. */
export type WorkflowFinding = components["schemas"]["WorkflowFinding"];

/** Step 4's *Your first issue* card: the picker's state, its pick and the cold-state pointers. */
export type OnboardingFirstIssue = components["schemas"]["OnboardingFirstIssue"];

/** A scored candidate with its reasoning — the pick, or one row of the safety-ranked backlog. */
export type OnboardingFirstIssueCandidate = components["schemas"]["OnboardingFirstIssueCandidate"];

/** One term of the safety score — what the detail affordance prints. */
export type OnboardingFirstIssueComponent = components["schemas"]["OnboardingFirstIssueComponent"];

/** One piece of the reasoning line, and the component or estimate it came from. */
export type OnboardingFirstIssueFragment = components["schemas"]["OnboardingFirstIssueFragment"];

/** *Or pick your own* — the backlog's qualifying candidates, safest first. */
export type OnboardingFirstIssueAlternatives = components["schemas"]["OnboardingFirstIssueAlternatives"];

/** The nightly estimator's schedule and latest run (AL.5, #281), as the picker passes it through. */
export type PlanningReestimationStatus = components["schemas"]["PlanningReestimationStatus"];

/**
 * The first-issue card's one read (BC.4, #393): the pick, the safety-ranked backlog behind
 * *↻ another* and *or pick your own*, and the dry-run policy the safety rows state.
 *
 * The policy travels as a {@link Reading} rather than a value: a safety row that could not read
 * the policy says so, and never guesses that the PR will open as a draft.
 */
export interface FirstIssueCard {
  /** The picker's answer: its state, the pick, the backlog counts and the cold-state pointers. */
  readonly firstIssue: OnboardingFirstIssue;
  /** The qualifying candidates, safest first, each with its own reasoning. */
  readonly alternatives: OnboardingFirstIssueAlternatives;
  /** The dry-run policy, or why it could not be read. */
  readonly dryRun: Reading<DryRunPolicy>;
}

/** How many alternatives the card reads — the service's most, so the sheet is the whole ranking. */
export const ALTERNATIVES_LIMIT = 50;

/** The wizard, as the service serves it. Each method takes the client last; tests pass one. */
export const onboarding = {
  /**
   * One repository's wizard.
   *
   * @param repo The repository, `owner/name`.
   * @param client The client to call through. Defaults to the server-side one.
   * @param signal Aborts the read — the poll's deadline.
   * @returns The rail, the choices, the card references and the surfacing rule.
   * @throws {ApiError} `422 validation_failed` for a malformed repository.
   */
  async read(repo: string, client: ApiClient = api(), signal?: AbortSignal): Promise<Onboarding> {
    return unwrap(await client.GET("/api/v1/onboarding", { params: { query: { repo } }, signal }));
  },

  /**
   * Whether the app should offer the wizard to this workspace — with no repository named.
   *
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The decision and its reason.
   */
  async surfacing(client: ApiClient = api()): Promise<OnboardingSurfacing> {
    return unwrap(await client.GET("/api/v1/onboarding/surfacing", {}));
  },

  /**
   * Change the wizard's choices — the dashboard banner's dismissal among them.
   *
   * @param repo The repository.
   * @param patch What changed.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The whole wizard, re-derived.
   */
  async update(repo: string, patch: OnboardingPatch, client: ApiClient = api()): Promise<Onboarding> {
    return unwrap(await client.PATCH("/api/v1/onboarding", { params: { query: { repo } }, body: patch }));
  },

  /**
   * Complete a step through the service's guard — refused unless it, and every step before it,
   * is done in reality.
   *
   * @param repo The repository.
   * @param step The step, 1–4.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The wizard after the guard answered yes.
   * @throws {ApiError} `409 onboarding_step_incomplete` with the stated reason.
   */
  async completeStep(repo: string, step: number, client: ApiClient = api()): Promise<Onboarding> {
    return unwrap(
      await client.POST("/api/v1/onboarding/complete-step", {
        params: { query: { repo } },
        body: { step },
      }),
    );
  },

  /**
   * *I've done this before* — mark the wizard bypassed. Imports nothing.
   *
   * @param repo The repository.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The wizard, the settings path to go to, and `configurationImported: false`.
   */
  async skip(repo: string, client: ApiClient = api()): Promise<OnboardingSkip> {
    return unwrap(await client.POST("/api/v1/onboarding/skip", { params: { query: { repo } } }));
  },

  /**
   * Step 3's tiles, each tier's gate evaluated against the workspace's merged loops.
   *
   * @param repo The repository.
   * @param client The client to call through. Defaults to the server-side one.
   * @param signal Aborts the read — the poll's deadline.
   * @returns The tiles in tile order, the active choice, the count and the studio's root.
   * @throws {ApiError} `422 validation_failed` for a malformed repository.
   */
  async templates(repo: string, client: ApiClient = api(), signal?: AbortSignal): Promise<OnboardingTemplateTiles> {
    return unwrap(await client.GET("/api/v1/onboarding/templates", { params: { query: { repo } }, signal }));
  },

  /**
   * Select a template — instantiate a published workflow from it (or reuse the live one already
   * made from it) and make it the repository's choice. Owner or admin.
   *
   * @param repo The repository.
   * @param slug The template.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The workflow behind the choice, every other instantiated workflow kept, the wizard.
   * @throws {ApiError} `409 onboarding_template_locked`, `422 onboarding_template_invalid` with the
   *   gate's `details.findings`, `403` below admin.
   */
  async selectTemplate(repo: string, slug: string, client: ApiClient = api()): Promise<OnboardingTemplateSelection> {
    return unwrap(
      await client.POST("/api/v1/onboarding/select-template", {
        params: { query: { repo } },
        body: { slug },
      }),
    );
  },

  /**
   * *Run my first loop* — queue the picked issue under the instantiated workflow.
   *
   * @param repo The repository.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The receipt.
   * @throws {ApiError} A refusal carrying the stated reason the action bar renders.
   */
  async launch(repo: string, client: ApiClient = api()): Promise<OnboardingLaunchReceipt> {
    return unwrap(await client.POST("/api/v1/onboarding/launch", { params: { query: { repo } } }));
  },

  /**
   * Step 4's safe pick — the picker's deterministic, explained answer over the sized backlog.
   *
   * @param repo The repository.
   * @param client The client to call through. Defaults to the server-side one.
   * @param signal Aborts the read — the poll's deadline.
   * @returns The state (`picked`, `sizing`, `empty`, `none_safe`), the pick with its reasoning,
   *   the backlog counts, the estimator's status and the planning pointer.
   * @throws {ApiError} `422 validation_failed` for a malformed repository.
   */
  async firstIssue(repo: string, client: ApiClient = api(), signal?: AbortSignal): Promise<OnboardingFirstIssue> {
    return unwrap(await client.GET("/api/v1/onboarding/first-issue", { params: { query: { repo } }, signal }));
  },

  /**
   * *Or pick your own* — the backlog's qualifying candidates, safest first, each with its own
   * reasoning and whether it clears the safety bar.
   *
   * @param repo The repository.
   * @param limit The most candidates to return, 1–50.
   * @param client The client to call through. Defaults to the server-side one.
   * @param signal Aborts the read — the poll's deadline.
   * @returns The ranked candidates and what was set aside.
   * @throws {ApiError} `422 validation_failed` for a malformed repository or limit.
   */
  async firstIssueAlternatives(
    repo: string,
    limit: number,
    client: ApiClient = api(),
    signal?: AbortSignal,
  ): Promise<OnboardingFirstIssueAlternatives> {
    return unwrap(
      await client.GET("/api/v1/onboarding/first-issue/alternatives", {
        params: { query: { repo, limit } },
        signal,
      }),
    );
  },
};

/**
 * The first-issue card's one read: the pick, the whole safety-ranked backlog, and the dry-run
 * policy — three calls in parallel, so the card is one poll rather than three.
 *
 * The pick and the backlog are what the card *is*, so either failing fails the read; the policy
 * is kept as a {@link Reading}, because a safety row that could not read it has something to say
 * (that it could not) and the pick row should still draw.
 *
 * @param repo The repository.
 * @param client The client to call through. Defaults to the server-side one.
 * @param signal Aborts every read — the poll's deadline.
 * @returns The card.
 * @throws {ApiError} What the picker answered, when it refused.
 */
export async function readFirstIssueCard(
  repo: string,
  client: ApiClient = api(),
  signal?: AbortSignal,
): Promise<FirstIssueCard> {
  const [firstIssue, alternatives, dryRun] = await Promise.all([
    onboarding.firstIssue(repo, client, signal),
    onboarding.firstIssueAlternatives(repo, ALTERNATIVES_LIMIT, client, signal),
    attempt(() => dryRunPolicy.read(client, signal)),
  ]);

  return { firstIssue, alternatives, dryRun };
}
