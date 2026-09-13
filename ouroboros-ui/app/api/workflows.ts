/**
 * Workflows — what mockup 04's studio reads and writes through `ouroboros-rest`.
 *
 * Two reads and one write, which is what S.1
 * ([#147](https://github.com/NobuData/ouroboros/issues/147)) needs of P.3's seven operations
 * ([#134](https://github.com/NobuData/ouroboros/issues/134)): the rail, one workflow in full,
 * and **+ New workflow**. The draft save, the publish and the version history are S.6's
 * ([#152](https://github.com/NobuData/ouroboros/issues/152)) and arrive here with it, so this
 * module is deliberately the studio *frame's* share of the contract and no more.
 *
 * ### The rail is served, never recomposed
 *
 * `GET /api/v1/workflows` carries every caption already composed — `6 stages · auto-merge`,
 * `used by 61% of runs`, `no runs yet` — beside the facts they were composed from. The
 * contract is explicit about why: the rail and the page head must not be able to draw two
 * different sentences from one row, and a client that divided `runs` by a denominator it does
 * not hold would print `used by 0% of runs` for a workspace with nothing to divide by. So
 * nothing in `app/workflows/` composes a caption from `stageCount` or `usagePercent`; it
 * prints `caption` and `usageCaption` as they arrive. The one sentence the studio *does*
 * compose is the trigger's — *Runs when a sized issue with effort ≤ M is queued* — because the
 * contract serves the predicate as structure and the ticket asks for it in words.
 *
 * ### The workspace is the session's
 *
 * There is no workspace in these paths and this client sends no `X-Ouro-Tenant`
 * (`app/api/server.ts` says why). Any member may read the rail and a workflow, viewers
 * included; the create is `owner` or `admin`, and the service is what enforces it —
 * `app/workflows/create-actions.ts` says what a member who reaches it anyway is told.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/**
 * One workflow on the rail, with P.4's statistics
 * ([#135](https://github.com/NobuData/ouroboros/issues/135)) computed per request.
 *
 * **`usagePercent` is `null` rather than `0` for a workspace with no runs in the window**, and
 * `usageCaption` already reads `no runs yet`. `stageCount` is `null` for a workflow nobody has
 * published, and `caption` already reads `not published`. Neither null is a value this module
 * or the studio supplies a default for.
 */
export type WorkflowRailEntry = components["schemas"]["WorkflowRailEntry"];

/** The whole rail: every non-archived workflow of the workspace, in creation order. */
export type WorkflowRail = components["schemas"]["WorkflowRail"];

/**
 * What the rail draws a workflow as — `active`, `paused` (the mockup's err-dot) or `archived`,
 * which is the soft delete and never appears on the rail at all.
 *
 * Named separately because the rail maps every one of them to a treatment, so a fourth status
 * added to the service is a build error in the studio rather than an entry that silently draws
 * as active.
 */
export type WorkflowStatus = components["schemas"]["WorkflowStatus"];

/** What a workflow does when it finishes — the second half of a rail caption, as structure. */
export type WorkflowTerminalAction = components["schemas"]["WorkflowTerminalAction"];

/**
 * A workflow, its draft slot and one published version — what `GET /api/v1/workflows/{id}`
 * answers, and what the page head is composed from.
 *
 * `version` is **`null`** for a workflow that has published nothing, which is the state
 * **+ New workflow** leaves behind and not an error; `draft.definition` is `null` for a
 * workflow with no draft, and `draft.updatedAt` — the mockup's *Last edited* — with it.
 */
export type WorkflowDetail = components["schemas"]["WorkflowDetail"];

/** One workflow's entity without its document — what a rename or a pause answers with. */
export type WorkflowSummary = components["schemas"]["WorkflowSummary"];

/** A workflow's one mutable document, and the etag that guards writing it. */
export type WorkflowDraft = components["schemas"]["WorkflowDraft"];

/** One published, immutable version — document and all. */
export type WorkflowVersion = components["schemas"]["WorkflowVersion"];

/**
 * A workflow definition — the P.2 DSL document
 * ([#133](https://github.com/NobuData/ouroboros/issues/133)), typed as the contract types it:
 * a JSON object and nothing more.
 *
 * Deliberately unconstrained there and therefore here. The grammar has one owner
 * (`schemas/workflow-dsl/v1.json`) and a draft is stored unvalidated — `{}` is the blank
 * canvas — so the only thing true of every document on this API is that it is an object.
 * `app/workflows/view.ts` reads the trigger out of one defensively for exactly that reason.
 */
export type WorkflowDefinition = components["schemas"]["WorkflowDefinition"];

/**
 * What **+ New workflow** sends: a name, the slug the dialog shows for it, and no definition —
 * the blank canvas is the contract's own default.
 */
export type CreateWorkflowRequest = components["schemas"]["CreateWorkflowRequest"];

/**
 * The code editor's symbol table — W.1
 * ([#177](https://github.com/NobuData/ouroboros/issues/177)): what to offer at each place in a
 * workflow file, and what a hover card says about each symbol, read by the service from the
 * grammar and the published schema, with the workspace's task routes and skills as suggestions.
 */
export type CodeSymbolTable = components["schemas"]["WorkflowCodeSymbolTable"];

/** Everything offered at one place in a file. */
export type CodeScope = components["schemas"]["WorkflowCodeScope"];

/** One completion. */
export type CodeCompletion = components["schemas"]["WorkflowCodeCompletion"];

/** What a hover card says about one symbol. */
export type CodeSymbol = components["schemas"]["WorkflowCodeSymbol"];

/** One run of a signature, and its colour. */
export type CodeSignaturePart = components["schemas"]["WorkflowCodeSignaturePart"];

/** Workflows, as `ouroboros-rest` serves them. */
export const workflows = {
  /**
   * The rail — every non-archived workflow this workspace has, with its captions composed.
   *
   * @param client The client to call through. Defaults to the server-side one; tests pass
   *   one over a stub `fetch`.
   * @returns The entries, in the order they were created. A workspace with no workflows
   *   answers an empty array — the studio's empty state, not a failure.
   * @throws {ApiError} What the service answered. A `401` redirects to login before this
   *   rejects.
   */
  async list(client: ApiClient = api()): Promise<readonly WorkflowRailEntry[]> {
    return unwrap(await client.GET("/api/v1/workflows", {})).workflows;
  },

  /**
   * One workflow in full: the entity, its draft slot, and the version in force.
   *
   * No `?version=` is ever sent from here. The studio frame describes what *runs*, which is
   * the version in force, and a reader browsing history is S.6's
   * ([#152](https://github.com/NobuData/ouroboros/issues/152)) concern.
   *
   * @param id The workflow's id — `workflows.id`, not its slug. The rail is what turns a slug
   *   in the URL into an id (`app/workflows/data.ts`), so a slug the workspace does not have
   *   never reaches this call.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The workflow. `version` is `null` for one that has published nothing.
   * @throws {ApiError} What the service answered — `404 workflow_not_found` for an id this
   *   workspace does not have, which is deliberately the same answer as one nobody has.
   */
  async read(id: string, client: ApiClient = api()): Promise<WorkflowDetail> {
    return unwrap(
      await client.GET("/api/v1/workflows/{id}", { params: { path: { id } } }),
    );
  },

  /**
   * Create one workflow — the rail's **+ New workflow**, in practice.
   *
   * **It creates a draft and publishes nothing.** The answer's `currentVersion` and `version`
   * are both `null`; the first **Publish** (S.6) is what makes a version. `slug` is sent
   * explicitly because the dialog shows it, which is the contract's own advice for a caller
   * who has an identifier in mind — the slug is what a stored `runs.workflow_tag` resolves
   * through, and it cannot be changed afterwards.
   *
   * @param body The name and the slug, composed by `app/workflows/create.ts`'s `createBody`.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The workflow as stored, with the draft its canvas will open on.
   * @throws {ApiError} What the service answered — `403 forbidden` for a member,
   *   `409 workflow_slug_taken` for a slug this workspace already uses, and
   *   `422 validation_failed` for a name or a slug the contract refuses.
   */
  async create(body: CreateWorkflowRequest, client: ApiClient = api()): Promise<WorkflowDetail> {
    return unwrap(await client.POST("/api/v1/workflows", { body }));
  },
};
