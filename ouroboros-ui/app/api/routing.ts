/**
 * Model routing — what mockup 06's `/models` surface reads from `ouroboros-rest`.
 *
 * Three reads, four writes and one question. The provider health strip
 * ([#196](https://github.com/NobuData/ouroboros/issues/196)) is what AA.1
 * ([#200](https://github.com/NobuData/ouroboros/issues/200)) draws above the matrix; the
 * matrix itself ([#195](https://github.com/NobuData/ouroboros/issues/195), with its numerics
 * from [#198](https://github.com/NobuData/ouroboros/issues/198)) is what AA.2
 * ([#201](https://github.com/NobuData/ouroboros/issues/201)) draws below it, and the rules
 * card AA.5 ([#204](https://github.com/NobuData/ouroboros/issues/204)) draws beside it is
 * where the three writes come from — a rule's switch, a new rule, and a rule removed — with
 * the registry list its builder chooses aliases from — and the fourth write is **Save routes**
 * itself, the batch AA.3 ([#202](https://github.com/NobuData/ouroboros/issues/202)) commits
 * after the chain editor has staged its edits. They are one page's calls to one tag, which is
 * why they are one module — and the fifth call, **Simulate routing**, is AA.4's
 * ([#203](https://github.com/NobuData/ouroboros/issues/203)): a `POST` that reads, asking Z.4's
 * endpoint ([#197](https://github.com/NobuData/ouroboros/issues/197)) what would run and why.
 *
 * ### The writes send structure, never a sentence
 *
 * `POST` and `PATCH /api/v1/routing/rules` carry a rule's `when` and `then` documents and
 * nothing else; the sentence the card prints is the database's generated `display`, which
 * the contract refuses in a request body rather than discarding. So there is no function
 * here that takes a string, and the rules card cannot be handed one to persist — which is
 * how "there is no free-text rule path" holds at the wire rather than in a form.
 *
 * ### The matrix is one request, and that is a correctness property
 *
 * `GET /api/v1/routing` carries the eight rows, every escalation rule and the spend card in
 * one payload. The contract is explicit about why, and the matrix is the half that would
 * break: its **Escalation** column and the rules card render the same rows, and its `$/run
 * avg` and the spend card's totals are aggregates over the same ledger over the same window.
 * Fetched apart they would be aggregates over those rows *at two instants* — a page that can
 * show a call in one figure and not the other — and two cards that disagree about what a rule
 * does for as long as one of them is in flight.
 *
 * What this adds over a raw call is what every resource file in this directory adds: a
 * name, the path written down once so a rename in the contract is a failed typecheck rather
 * than a `404` behind a chip, and the body rather than the body-or-nothing.
 *
 * ### Nothing here triggers a check
 *
 * `GET /api/v1/routing/providers` is a **read of stored snapshots**, and the contract is
 * emphatic about why: the cadence belongs to the service's own scheduler, and a *check now*
 * button would let anybody holding a session make `ouroboros-rest` issue outbound requests
 * at whatever rate they can click — against a vendor's rate limit, signed with the
 * workspace's own credential. So there is no refresh function in this module, and the page
 * has no control that would call one.
 *
 * ### The workspace is the session's
 *
 * There is no workspace in this path and this client sends no `X-Ouro-Tenant`
 * (`app/api/server.ts` says why), so the strip is scoped to the session's active
 * organization. Any member may read it, viewers included: *is Ollama up* is the kind of
 * thing a viewer exists to be able to look at.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/**
 * One chip on the provider health strip: a provider connection, and what the last check
 * honestly found.
 *
 * **Every optional fact is `null` rather than a stand-in value**, and the page is built on
 * that: `latencyMs` is present only where a check measured one, `models` only where a check
 * counted them, and neither has a fallback. `0ms` is an excellent latency for a provider
 * nothing has ever called, which is why the contract refuses to invent it and why nothing
 * in `app/models/` supplies a default for it either.
 */
export type ProviderHealth = components["schemas"]["ProviderHealth"];

/** The whole strip: every connection in the workspace, ordered by display name. */
export type ProviderHealthStrip = components["schemas"]["ProviderHealthStrip"];

/**
 * Whether a provider is usable, as far as anything knows — the four the schema publishes.
 *
 * Named separately because the strip maps every one of them to a treatment
 * (`app/models/view.ts`), so a fifth status added to the service is a build error in the
 * screen rather than a chip that silently draws as healthy. That is the whole of decision
 * **M8** on this side of the wire: `unknown` is a state, and it is never rendered as green.
 */
export type ProviderStatus = ProviderHealth["status"];

/**
 * Which question produced a provider's state — or `null` when no check this service
 * performs did, which is a seeded state or a provider it has nothing cheap to ask.
 *
 * Published by the contract because the two are different claims: *the socket answered*
 * says nothing about a credential, and *the key is valid* says almost nothing about whether
 * a completion would succeed. The strip's hover is what says which one it was.
 */
export type ProviderCheck = ProviderHealth["check"];

/**
 * Which adapter reaches a provider — the six spellings V015 admits, and the vocabulary the
 * spend card names its rows from (`app/models/spend.ts`).
 */
export type ProviderKind = components["schemas"]["ProviderConnectionKind"];

/* ------------------------------------------------------------------ the routing matrix */

/**
 * The routing page's read below the strip: the matrix, the escalation rules and the spend
 * card, in one payload because they are one screen.
 *
 * `taskKinds` is **empty rather than absent** for a workspace whose routing foundations have
 * not been seeded — a state AA.6 ([#205](https://github.com/NobuData/ouroboros/issues/205))
 * owns the guidance for, and one this module distinguishes from a read that failed the same
 * way the strip does.
 */
export type RoutingMatrix = components["schemas"]["RoutingMatrix"];

/**
 * One row of the matrix: a task kind, its description, where it sorts, and the route it
 * resolves through — or **`null`** for a kind with no route.
 *
 * That null is a legal state the schema publishes on purpose, and the matrix draws the row
 * anyway: hiding a kind because nothing routes it would hide the very kind somebody came to
 * this page to configure.
 */
export type RoutingTaskKind = components["schemas"]["RoutingTaskKind"];

/** One task kind's route: its tag, its policy triple, its chain and its measured numerics. */
export type Route = components["schemas"]["Route"];

/**
 * One numbered hop of a configured chain — the alias, what it resolves to, and where it runs.
 *
 * `provider` is **`null`** for an alias with no provider bound yet, and the hop keeps its
 * place either way: a chain that dropped a hop for that reason would arrive shorter than the
 * operator configured it, and the matrix would print a fallback the workspace does not have.
 */
export type RouteHop = components["schemas"]["RouteHop"];

/**
 * A row's two numeric columns, or the nulls that mean nobody measured them.
 *
 * The type the matrix's honesty rests on (roadmap decision **M7**). `costCentsPerRunAvg` and
 * `latencyP50Ms` are `null` exactly when the ledger holds nothing to average or take a median
 * of, and nothing in `app/models/` supplies a default for either: a workspace that has run
 * nothing has not spent `$0.00` per run, it has spent nothing anybody can average.
 */
export type RouteStats = components["schemas"]["RouteStats"];

/**
 * One escalation rule, with the sentence the **database** derived from its structure.
 *
 * `display` is the field this application must never compose for itself. It is a generated
 * column (V018), so the rules card, the matrix's escalation column and a resolution
 * explanation all print the same string because there is only one — which is what makes *the
 * matrix and the rules card cannot disagree* a property of the schema rather than a promise
 * two components make separately.
 */
export type EscalationRule = components["schemas"]["EscalationRule"];

/**
 * A rule's predicate: at least one of `effort_gte`, `label` and `diff_kind`, ANDed.
 *
 * The empty object is refused by the contract — a rule with no condition always fires, which
 * is a route rather than an escalation — and the builder (`app/models/rules.ts`) cannot
 * produce one, because it composes exactly one condition from one select.
 */
export type EscalationWhen = components["schemas"]["EscalationWhen"];

/**
 * A rule's route modification — **exactly one** of `use_alias`, `add_vote` and
 * `route_local`, as a closed union.
 *
 * The union is what makes *invalid combinations unreachable* a property of the types: a
 * `use_alias` without an alias, or a `route_local` carrying a task kind, does not typecheck,
 * so the builder's shape is the contract's shape and nothing between them can add a fourth
 * action or drop a required target.
 */
export type EscalationThen = components["schemas"]["EscalationThen"];

/**
 * What the builder sends. `when` and `then` and nothing else — there is no `display`, and
 * its absence is the enforcement.
 */
export type CreateEscalationRule = components["schemas"]["CreateEscalationRule"];

/**
 * What a switch sends: `{ enabled }` and nothing else, so turning a rule off never resends a
 * predicate the client has no intention of changing.
 */
export type UpdateEscalationRule = components["schemas"]["UpdateEscalationRule"];

/**
 * One alias a route — or a rule — may name, with what it resolves to.
 *
 * `provider` is `null` for an alias with no provider bound yet, and the builder still offers
 * it: a rule may name it, and the resolution is what says so honestly when it does.
 */
export type RoutingAlias = components["schemas"]["RoutingAlias"];

/* ------------------------------------------------------------------ Save routes */

/**
 * One entry of a **Save routes** batch: a task kind, the chain as an array, and the policy
 * triple.
 *
 * **The chain is the array.** There are no positions in the request — hop order is array
 * order, and the server numbers them densely from 1 — and a hop names an alias, never a raw
 * model id (decision M1). **All three policy fields are required**: a `PUT` has no
 * leave-this-alone case, so a chain edit sends the floor and the cap it did not touch, and
 * `null` is how *off* and *no cap* are said.
 */
export type SaveRouteInput = components["schemas"]["SaveRouteInput"];

/** One hop of a batch entry: its alias, and the inspector's note or `null`. */
export type RouteHopInput = components["schemas"]["RouteHopInput"];

/**
 * What a save answers with: the revision it wrote — **`null`** when the batch changed nothing —
 * and the routes as they now stand, re-read after the commit rather than echoed back.
 */
export type SaveRoutesResult = components["schemas"]["SaveRoutesResult"];

/* ------------------------------------------------------------------ Simulate routing */

/**
 * What to simulate: a task kind, and what is known about the work.
 *
 * There is no workspace in it — the workspace is the session's, as everywhere in `/api/v1`,
 * and a body that could name one would be a body that could simulate somebody else's routes.
 */
export type RoutingSimulationRequest = components["schemas"]["RoutingSimulationRequest"];

/**
 * What is known about the work: `effort`, `labels`, `diffKind` — exactly the three facts an
 * escalation rule may test, and nothing else. **Every field is optional and absence is a real
 * answer**: an unstated fact never satisfies a condition about it, and `null` is refused.
 */
export type RoutingSimulationContext = components["schemas"]["RoutingSimulationContext"];

/**
 * One resolution — what would run for a task kind in a context, and why.
 *
 * **Every sentence in it is the service's, rendered verbatim.** Each hop, each matched rule,
 * the floor and a failure carry a stable `code` to branch on and an `explanation` to print;
 * nothing in `app/models/` composes a second account of any of them. `fail_run` is an
 * `outcome` of a `200`, not an error: a well-formed question about a route that exists is
 * answered, and the answer may be *this run would not proceed*.
 */
export type Resolution = components["schemas"]["Resolution"];

/**
 * One hop of a resolved chain — kept or dropped, and why. **Dropped hops stay in the
 * array**, so the panel can draw hop 2 struck through with its reason beside it.
 */
export type ResolutionHop = components["schemas"]["ResolutionHop"];

/** One escalation rule whose predicate matched, and what it did — or why it did nothing. */
export type ResolutionRule = components["schemas"]["ResolutionRule"];

/** A second opinion an `add_vote` rule attached: a requirement on the executor, not a hop. */
export type ResolutionVote = components["schemas"]["ResolutionVote"];

/** What the floor decided — recorded on every resolution, including the ones it did not touch. */
export type ResolutionFloor = components["schemas"]["ResolutionFloor"];

/** Why a resolution refuses to produce a chain — present exactly when `outcome` is `fail_run`. */
export type ResolutionFailure = components["schemas"]["ResolutionFailure"];

/**
 * Where a resolved hop's model runs, with the health the resolution decided on — the one
 * shape on this page that carries a status beside a provider, because the sentence about
 * the hop was composed from it.
 */
export type ResolvedProvider = components["schemas"]["ResolvedProvider"];

/* ------------------------------------------------------------------ the spend card */

/**
 * The **Spend by provider · 30d** card, its footnote and the window it was measured over
 * ([#198](https://github.com/NobuData/ouroboros/issues/198)).
 *
 * Nothing in it is coalesced, and the card is built on that: a workspace that has spent
 * nothing answers with an empty `providers`, a null total and a **null** share — never
 * `$0.00`. Decision **M7** on this side of the wire.
 */
export type RoutingSpend = components["schemas"]["RoutingSpend"];

/**
 * One metered row of the spend card.
 *
 * **`spendCents: 0` and `spendCents: null` are the two states the card exists to keep
 * apart.** Zero is calls priced at nothing; null is calls nobody priced, which renders as
 * *unpriced* and never as a figure. A row can carry both: `spendCents: 0` beside a non-zero
 * `unpricedCalls` is a local provider whose routed calls cost nothing and whose earlier calls
 * nobody has priced — and the card says both.
 */
export type ProviderSpend = components["schemas"]["ProviderSpend"];

/** Model routing, as `ouroboros-rest` serves it. */
export const routing = {
  /**
   * Every provider connection in the workspace, and what is known about each.
   *
   * @param client The client to call through. Defaults to the server-side one; tests pass
   *   one over a stub `fetch`.
   * @returns The strip. A workspace that has configured no providers answers an empty
   *   array — the page's empty state, not a failure.
   * @throws {ApiError} What the service answered. A `401` redirects to login before this
   *   rejects.
   */
  async providers(client: ApiClient = api()): Promise<ProviderHealthStrip> {
    return unwrap(await client.GET("/api/v1/routing/providers", {}));
  },

  /**
   * The matrix, the escalation rules and the spend card — everything mockup 06 draws below
   * the strip.
   *
   * One request rather than three, for the reason this module's note gives: the three regions
   * are aggregates and derivations over the same rows, and reading them apart is what would
   * let them disagree.
   *
   * @param client The client to call through. Defaults to the server-side one; tests pass
   *   one over a stub `fetch`.
   * @returns The payload. A workspace whose routing foundations have not been seeded answers
   *   with empty arrays — the page's empty state, not a failure.
   * @throws {ApiError} What the service answered. A `401` redirects to login before this
   *   rejects.
   */
  async matrix(client: ApiClient = api()): Promise<RoutingMatrix> {
    return unwrap(await client.GET("/api/v1/routing", {}));
  },

  /**
   * Every alias in the workspace, unbound ones included — the list the rule builder's alias
   * select is built from.
   *
   * Read **on demand** rather than with the matrix, for the reason `app/providers/audit-actions.ts`
   * gives for the audit sheet: the builder is behind a button most visits never press, and a
   * member session — which has no builder — would pay for a list nothing draws.
   *
   * @param client The client to call through. Defaults to the server-side one; tests pass
   *   one over a stub `fetch`.
   * @returns The registry list, ordered by name. Empty for a workspace with no aliases.
   * @throws {ApiError} What the service answered.
   */
  async aliases(client: ApiClient = api()): Promise<readonly RoutingAlias[]> {
    return unwrap(await client.GET("/api/v1/routing/aliases", {})).aliases;
  },

  /**
   * Commit one press of **Save routes** — the whole staged batch, atomically.
   *
   * Every route in the body is written or none is: the contract decides every refusal before
   * the transaction opens, so a `422` here means *nothing was saved*, and a corrected batch is
   * re-sent rather than reconciled. Its `details.routes` is keyed by **task kind**, which is
   * what lets the matrix mark exactly the row that was refused.
   *
   * @param routes The changed routes, and only those — a route nobody edited is a route the
   *   server is not asked to rewrite.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The revision written, or `null` for a batch that changed nothing, and the routes
   *   as re-read.
   * @throws {ApiError} What the service answered — `403 forbidden` for a role that may read
   *   the matrix and not write it, `422 route_save_invalid` naming the routes it refused.
   */
  async saveRoutes(
    routes: readonly SaveRouteInput[],
    client: ApiClient = api(),
  ): Promise<SaveRoutesResult> {
    return unwrap(await client.PUT("/api/v1/routing/routes", { body: { routes: [...routes] } }));
  },

  /**
   * Write a new escalation rule.
   *
   * @param rule Its structure. `enabled` and `sortOrder` are left to the contract's
   *   defaults — on, and appended — because a new rule that silently claimed the first
   *   position would change what every existing rule does.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The rule as written, carrying the `display` the database derived for it. That
   *   string is the only sentence the card will ever print for it.
   * @throws {ApiError} What the service answered — `403 forbidden` for a role that may read
   *   the card and not write to it, `422 validation_failed` for a structure the schema
   *   refuses, `404` for a task kind or alias the workspace does not have.
   */
  async addRule(rule: CreateEscalationRule, client: ApiClient = api()): Promise<EscalationRule> {
    return unwrap(await client.POST("/api/v1/routing/rules", { body: rule }));
  },

  /**
   * Change a rule — the card's switch, in practice.
   *
   * A `PATCH` carrying only what changes, so a switch never resends a predicate. The contract
   * regenerates `display` if `when` or `then` are among the changes, and the answer carries
   * the regenerated sentence.
   *
   * @param id The rule's id.
   * @param change What changes. `{ enabled }` is the whole of what the card sends.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The rule as it now stands.
   * @throws {ApiError} What the service answered — `403 forbidden` for a role that may not
   *   press the switch, `404 escalation_rule_not_found` for a rule somebody else removed.
   */
  async changeRule(
    id: string,
    change: UpdateEscalationRule,
    client: ApiClient = api(),
  ): Promise<EscalationRule> {
    return unwrap(
      await client.PATCH("/api/v1/routing/rules/{id}", {
        params: { path: { id } },
        body: change,
      }),
    );
  },

  /**
   * Remove a rule outright.
   *
   * **This is not the switch.** {@link routing.changeRule} with `{ enabled: false }` suspends
   * a rule and keeps its place and its sentence; this is for a rule that was a mistake, which
   * is why the card asks before calling it.
   *
   * A `204` with no body, so there is nothing to unwrap: the middleware behind `client` has
   * already thrown for any answer that was not success.
   *
   * @param id The rule's id.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns Nothing — there is nothing to say about a row that no longer exists.
   * @throws {ApiError} What the service answered — `403 forbidden` for a role that may not
   *   remove rules, `404 escalation_rule_not_found` for one already gone.
   */
  async removeRule(id: string, client: ApiClient = api()): Promise<void> {
    await client.DELETE("/api/v1/routing/rules/{id}", { params: { path: { id } } });
  },

  /**
   * Ask what would run for a task kind in a context — mockup 06's **Simulate routing**.
   *
   * **A `POST` that creates nothing.** The contract explains the verb: a context is a nested
   * document with an array in it, and `?ctx[labels][]=security` is a shape every client
   * library spells differently. Nothing is written, the answer is a `200`, and the same
   * question asked twice against the same route and snapshot answers byte for byte.
   *
   * **The answer is the resolution function's, unchanged.** The endpoint calls the same
   * `ResolutionService` execution calls and returns what it said — which is what makes the
   * panel a window onto routing rather than a second implementation of it.
   *
   * @param request The task kind, and what is known about the work. Facts the caller does
   *   not have are **absent**, never `null` and never defaulted: an unstated effort is
   *   unknown, not small.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The resolution — `fail_run` included, since that is an answer and not an error.
   * @throws {ApiError} What the service answered — `404 route_not_found` for a kind with no
   *   chain to explain, `422 validation_failed` for a context carrying a fact no rule could
   *   read.
   */
  async simulate(
    request: RoutingSimulationRequest,
    client: ApiClient = api(),
  ): Promise<Resolution> {
    return unwrap(await client.POST("/api/v1/routing/simulate", { body: request }));
  },
};
