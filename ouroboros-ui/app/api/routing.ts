/**
 * Model routing — what mockup 06's `/models` surface reads from `ouroboros-rest`.
 *
 * Two operations. The provider health strip
 * ([#196](https://github.com/NobuData/ouroboros/issues/196)) is what AA.1
 * ([#200](https://github.com/NobuData/ouroboros/issues/200)) draws above the matrix; the
 * matrix itself ([#195](https://github.com/NobuData/ouroboros/issues/195), with its numerics
 * from [#198](https://github.com/NobuData/ouroboros/issues/198)) is what AA.2
 * ([#201](https://github.com/NobuData/ouroboros/issues/201)) draws below it. They are one
 * page's calls to one tag, which is why they are one module; the inspector's simulate call is
 * AA.4's ([#203](https://github.com/NobuData/ouroboros/issues/203)) and belongs here beside
 * them when it arrives.
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
};
