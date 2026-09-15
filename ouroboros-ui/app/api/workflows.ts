/**
 * Workflows — what mockup 04's studio reads and writes through `ouroboros-rest`.
 *
 * The rail, one workflow in full and **+ New workflow** are S.1's
 * ([#147](https://github.com/NobuData/ouroboros/issues/147)) share of P.3's operations
 * ([#134](https://github.com/NobuData/ouroboros/issues/134)); the draft save, the publish and the
 * dry run are S.6's ([#152](https://github.com/NobuData/ouroboros/issues/152)). The version
 * history is not read by anything yet, so it is not here.
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

/**
 * One entry of the code view's diagnostics stream — W.2
 * ([#178](https://github.com/NobuData/ouroboros/issues/178)): a 1-based line and column range, and what
 * to say about it. A refused save's parse errors take this shape too, in `details.diagnostics`, which is
 * what the code editor draws (V.4, [#172](https://github.com/NobuData/ouroboros/issues/172)).
 */
export type CodeDiagnostic = components["schemas"]["CodeDiagnostic"];

/**
 * One workflow as a file of the code view — U.3
 * ([#167](https://github.com/NobuData/ouroboros/issues/167)): the TypeScript projection of its
 * draft, with the draft slot's etag.
 *
 * **One draft, two editors** (decision **C3**): `etag` is the same token `WorkflowDetail.draft`
 * carries for the canvas, so the two editors are reading one row, not two copies of it.
 */
export type WorkflowCode = components["schemas"]["WorkflowCode"];

/**
 * The code view's explorer — U.3's `GET /api/v1/workflows/code-tree`: every file the virtual
 * project has, and nothing it does not (decision **C6**). **Directories are not entries**; a client
 * groups the files by the directory in their `path`, so an empty directory cannot be drawn.
 */
export type WorkflowCodeTree = components["schemas"]["WorkflowCodeTree"];

/** One file of the explorer: a workflow's `.loop.ts`, or `ouroboros.config.ts`. */
export type WorkflowCodeTreeFile = components["schemas"]["WorkflowCodeTreeFile"];

/** `ouroboros.config.ts` — read-only, printed from the registry on every read, stored nowhere. */
export type WorkflowCodeConfig = components["schemas"]["WorkflowCodeConfig"];

/**
 * The stage catalog — R.3 ([#145](https://github.com/NobuData/ouroboros/issues/145)): every node
 * type the published DSL schema declares, each with its glyph, its config JSON Schema and its
 * defaults, and this workspace's advisory suggestions (skill names, task routes).
 *
 * The inspector (S.4, [#150](https://github.com/NobuData/ouroboros/issues/150)) draws its forms
 * from these schemas, so a node type added to the DSL gets a form without a UI change.
 */
export type WorkflowStageCatalog = components["schemas"]["WorkflowStageCatalog"];

/** One node type in the catalog. */
export type WorkflowStageType = components["schemas"]["WorkflowStageType"];

/** The names the inspector offers — advice, never an enumeration (decision **P7**). */
export type WorkflowStageSuggestions = components["schemas"]["WorkflowStageSuggestions"];

/**
 * One reason a definition may not be published, anchored where the canvas can select it — what a
 * refused publish carries in `details.findings`, and what a dry run of an invalid definition
 * answers with.
 */
export type WorkflowFinding = components["schemas"]["WorkflowFinding"];

/** An edge, named by its ordered pair — the dry run's `highlightPath` is a list of these. */
export type WorkflowEdgeRef = components["schemas"]["WorkflowEdgeRef"];

/** What a dry run answers: the ticket it tested, any findings, the walk and the path to paint. */
export type WorkflowDryRunResult = components["schemas"]["WorkflowDryRunResult"];

/** One stage the dry run reached. */
export type WorkflowDryRunStep = components["schemas"]["WorkflowDryRunStep"];

/** One edge out of a stage on the walk, and what the walk did with it. */
export type WorkflowDryRunEdge = components["schemas"]["WorkflowDryRunEdge"];

/** One predicate tested against the ticket. */
export type WorkflowPredicateEvaluation = components["schemas"]["WorkflowPredicateEvaluation"];

/** The ticket a dry run tested. */
export type WorkflowDryRunTicket = components["schemas"]["WorkflowDryRunTicket"];

/** The code a `409` answers for a draft that has no faithful spelling as a file (U.3). */
export const WORKFLOW_CODE_UNPROJECTABLE = "workflow_code_unprojectable";

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

  /**
   * The stage catalog — what the inspector's forms are generated from (S.4,
   * [#150](https://github.com/NobuData/ouroboros/issues/150)).
   *
   * @param client The client to call through. Defaults to the server-side one.
   * @returns Every node type, in the schema's order, and the workspace's suggestions. An empty
   *   suggestion list means *nothing to suggest*, not *nothing allowed*.
   * @throws {ApiError} What the service answered.
   */
  async catalog(client: ApiClient = api()): Promise<WorkflowStageCatalog> {
    return unwrap(await client.GET("/api/v1/workflows/catalog", {}));
  },

  /**
   * One workflow as a file — the code view's read (V.1,
   * [#169](https://github.com/NobuData/ouroboros/issues/169)).
   *
   * Always the draft's file: no `?version=` is sent, for the reason {@link workflows.read}
   * sends none. A workflow with no draft answers the version in force, editable, which is what
   * the canvas opens on too.
   *
   * @param slug The workflow's slug — this endpoint takes the slug, not the id. The code route
   *   resolves it against the rail first (`app/workflows/code/code-data.ts`), so a slug the
   *   workspace does not have never reaches this call.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The file, its etag, and the version in force.
   * @throws {ApiError} What the service answered — `409 workflow_code_unprojectable` (see
   *   {@link WORKFLOW_CODE_UNPROJECTABLE}) for a draft with no faithful spelling as code, with
   *   the validator's findings in `details.findings`; `404 workflow_not_found` for a slug this
   *   workspace does not have.
   */
  async code(slug: string, client: ApiClient = api()): Promise<WorkflowCode> {
    const file = unwrap(
      await client.GET("/api/v1/workflows/{slug}/code", { params: { path: { slug } } }),
    );

    // `outlineRef` is typed `null` and nothing else, and openapi-fetch's `Readable` drops a
    // response property whose only type is `null` (`NonNullable<null>` is `never`, which extends
    // its `$Write` marker). The contract serves it and it is always `null`, so it is restored
    // here rather than widening a type every caller reads.
    return { ...file, outlineRef: null };
  },

  /**
   * The explorer — the code view's file list (V.3,
   * [#171](https://github.com/NobuData/ouroboros/issues/171)).
   *
   * @param client The client to call through. Defaults to the server-side one.
   * @returns One `workflows/<slug>.loop.ts` per workflow on the rail, in the rail's order, then
   *   `ouroboros.config.ts`.
   * @throws {ApiError} What the service answered.
   */
  async tree(client: ApiClient = api()): Promise<WorkflowCodeTree> {
    return unwrap(await client.GET("/api/v1/workflows/code-tree", {}));
  },

  /**
   * `ouroboros.config.ts`, as the code view opens it (V.3,
   * [#171](https://github.com/NobuData/ouroboros/issues/171)).
   *
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The file, always `readOnly: true` — a save is refused with a `405`, so nothing here
   *   offers one.
   * @throws {ApiError} What the service answered.
   */
  async config(client: ApiClient = api()): Promise<WorkflowCodeConfig> {
    return unwrap(await client.GET("/api/v1/workflows/code-config", {}));
  },

  /**
   * Save the draft — the canvas's autosave (S.6, [#152](https://github.com/NobuData/ouroboros/issues/152)).
   *
   * **A replacement guarded by the etag.** The whole document is written, and only if the draft is
   * still the one `etag` names: a second tab that saved in between makes this a `409`, and nothing is
   * overwritten. `*` is never sent from here — opting out of the guard is not something autosave does.
   *
   * @param id The workflow's id.
   * @param etag The etag of the draft this document was edited from — the last save's, or the page read's.
   * @param definition The whole document, as the canvas holds it.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The draft slot after the write: the etag the next save sends, and the *Last edited* stamp.
   * @throws {ApiError} What the service answered — `409 workflow_draft_conflict` for a stale etag
   *   (`app/workflows/autosave.ts` names the code for the client), `403 forbidden` for a role that
   *   may not edit.
   */
  async saveDraft(
    id: string,
    etag: string,
    definition: WorkflowDefinition,
    client: ApiClient = api(),
  ): Promise<WorkflowDraft> {
    return unwrap(
      await client.PUT("/api/v1/workflows/{id}/draft", {
        params: { path: { id }, header: { "If-Match": etag } },
        body: { definition },
      }),
    );
  },

  /**
   * Save a file into the shared draft — the code editor's autosave (V.4,
   * [#172](https://github.com/NobuData/ouroboros/issues/172)), on U.3's contract.
   *
   * **A file that does not read changes nothing** (decision C4): the service parses before it writes,
   * so a typo is a `422` and the draft — and the canvas showing it — stays as it was. **A replacement
   * guarded by the etag**, as {@link workflows.saveDraft} is: the canvas and the code editor write one
   * row, so a stale etag from either is a `409` naming the editor that won. `*` is never sent.
   *
   * @param slug The workflow's slug — this endpoint takes the slug, as {@link workflows.code} does.
   * @param etag The etag of the draft this text was typed over — the last save's, or the page read's.
   * @param text The whole file.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The file as it now reads from the stored draft — printed canonically, so its text may differ
   *   from `text` in formatting, never in meaning — with the etag the next save sends.
   * @throws {ApiError} What the service answered — `422 workflow_code_invalid` with the parse errors in
   *   `details.diagnostics`, `409 workflow_draft_conflict` for a stale etag, `403 forbidden` for a role
   *   that may not edit, `404 workflow_not_found`, `413 payload_too_large`.
   */
  async saveCode(slug: string, etag: string, text: string, client: ApiClient = api()): Promise<WorkflowCode> {
    const file = unwrap(
      await client.PUT("/api/v1/workflows/{slug}/code", {
        params: { path: { slug }, header: { "If-Match": etag } },
        body: { text },
      }),
    );

    // Restored for the reason `code` gives.
    return { ...file, outlineRef: null };
  },

  /**
   * Publish the draft as the next immutable version — **Publish v15**.
   *
   * @param id The workflow's id.
   * @param changeNote What changed, in the publisher's words, or `undefined` for a publish with
   *   nothing to say — a blank note is never sent, because the contract refuses one.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The version now in force.
   * @throws {ApiError} What the service answered — `422 workflow_definition_invalid` with the
   *   findings (`app/workflows/publish.ts` names the code for the client), `409` when the draft or
   *   the version number moved, `502 engine_unavailable`.
   */
  async publish(
    id: string,
    changeNote: string | undefined,
    client: ApiClient = api(),
  ): Promise<WorkflowVersion> {
    return unwrap(
      await client.POST("/api/v1/workflows/{id}/publish", {
        params: { path: { id } },
        body: changeNote === undefined ? {} : { changeNote },
      }),
    );
  },

  /**
   * Walk the stored draft for one issue — **Dry run with issue #485**.
   *
   * @param id The workflow's id.
   * @param issueId The issue's `github_issues.id` — its facts are read by the service, never sent.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The walk, the ticket it tested, and the findings of a definition that does not validate.
   * @throws {ApiError} What the service answered — `404 workflow_dry_run_issue_not_found`,
   *   `409 workflow_draft_absent`, `502 engine_unavailable`.
   */
  async dryRun(id: string, issueId: string, client: ApiClient = api()): Promise<WorkflowDryRunResult> {
    return unwrap(
      await client.POST("/api/v1/workflows/{id}/dry-run", {
        params: { path: { id } },
        body: { issueId },
      }),
    );
  },
};
