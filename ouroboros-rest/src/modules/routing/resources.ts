/**
 * Rows → resources, for the routing editor — the same seam `provider-health/resources.ts` and
 * `pricing/resources.ts` both keep, and for the same reason.
 *
 * Z.2 ([#195](https://github.com/NobuData/ouroboros/issues/195)). The rows are the database's
 * (snake_case, `Date`s, nulls for absence); the resources are the contract's (camelCase, ISO
 * 8601, and exactly what `openapi.yaml` promises). Three decisions are made here rather than
 * at every call site that will eventually build one.
 *
 * **1. A hop keeps its number, and dropped-looking hops do not exist here.** This is the
 * *configured* chain, not a resolution — `position` is `route_hops.position`, dense from 1 by
 * V016's constraint trigger, and it is the number the inspector's rail prints and the number
 * `floorHopIndex` counts. Nothing here says whether a hop would be used: that is Z.1's
 * resolution, served by Z.4 (#197), and a second opinion about it published from the editor
 * would be a second thing to disagree with the first.
 *
 * **2. An unbound alias arrives with `provider: null`, not as a missing hop.** V019 permits an
 * alias created ahead of its key, and `management.repository.ts` left-joins the connection for
 * exactly this: a three-hop chain that arrived as two would be a silence the matrix could not
 * draw. The resolution line is simply empty, which is what the operator's configuration
 * honestly is.
 *
 * **3. `stats` is measured or it is null**, which is decision **M7** rather than a placeholder.
 * The matrix draws `$/run avg` and `p50 latency` per row and Z.5
 * ([#198](https://github.com/NobuData/ouroboros/issues/198)) computes both from `token_usage`;
 * the rule they are computed under is *no data → em-dash, never a fabricated number*, so a kind
 * nothing has been spent on arrives as two nulls and `0` appears nowhere in this file as a
 * stand-in for *we did not measure this*. Z.5 added the spend card beside them on the same
 * terms — see {@link RoutingSpendResource}, where the distinction between a total that is
 * genuinely zero and a total nobody has priced is the whole of the shape.
 */

import type { EscalationThen, EscalationWhen, ProviderConnectionKind } from "../db/schema";
import type {
  ManagedHopRow,
  ManagedRouteRow,
  ManagedRuleRow,
  TaskKindRow,
} from "./management.rows";
import type { AliasRow } from "./routing.rows";

/**
 * Where a hop's model runs — the four identifying facts, and no health.
 *
 * Health is deliberately absent: `GET /api/v1/routing/providers` is the one place a status
 * comes from (Z.3), the strip and the matrix are drawn from the same payload on the same page,
 * and a status published twice is a status that can be shown two ways at once.
 */
export interface RouteProviderResource {
  /** The connection's id — how mockup 07's surfaces address it. */
  readonly id: string;
  /** Which adapter reaches it. */
  readonly kind: ProviderConnectionKind;
  /** What the resolution line prints beside the model — `Anthropic`, `Ollama`. */
  readonly displayName: string;
  /** Where it is, or null for a kind reached at its vendor's own endpoint. */
  readonly baseUrl: string | null;
}

/** One numbered hop of a configured chain. */
export interface RouteHopResource {
  /** `route_hops.position`; 1 is the primary. Dense by constraint, which is what the floor counts. */
  readonly position: number;
  /** The alias this hop names — `coder-max`. The only thing a route may name (decision **M1**). */
  readonly alias: string;
  /** What the alias resolves to — `claude-fable-5`. The resolution line's first half. */
  readonly modelId: string;
  /** The operator's sentence for this hop, or null. */
  readonly note: string | null;
  /** Where it runs, or **null** for an alias with no connection bound yet (V019). */
  readonly provider: RouteProviderResource | null;
}

/**
 * The matrix's two numeric columns, or nulls where nothing has been measured.
 *
 * Both are Z.5's ([#198](https://github.com/NobuData/ouroboros/issues/198)), computed from
 * `token_usage` — which V020 gave a `task_kind` and a `latency_ms` for exactly this. A null is
 * the answer decision **M7** requires: a workspace that has run nothing has not spent `$0.00`
 * per run, it has spent nothing anybody can average.
 *
 * **The three counts are why a `0` here can be believed.** `costCentsPerRunAvg: 0` with
 * `pricedCalls: 15` is fifteen calls that really did cost nothing — a `docs` pass on a local
 * model — and `costCentsPerRunAvg: null` with `unpricedCalls: 15` is fifteen calls nobody has
 * priced. Those are different facts about the same money and the em-dash belongs to only one of
 * them, so the counts are published rather than left for a client to guess at from a null.
 */
export interface RouteStatsResource {
  /** The row's `$/run avg`, in cents, or null when no priced call has been attributed to this kind. */
  readonly costCentsPerRunAvg: number | null;
  /** The row's `p50 latency`, in milliseconds, or null when nothing timed a call for this kind. */
  readonly latencyP50Ms: number | null;
  /** How many calls of this kind carried a price — what {@link RouteStatsResource.costCentsPerRunAvg} averages. */
  readonly pricedCalls: number;
  /**
   * How many carried none — the DASH-J.4 ([#92](https://github.com/NobuData/ouroboros/issues/92))
   * state, surfaced rather than rounded away.
   *
   * Non-zero means the average above is over *part* of this kind's work, which is the `≈` the
   * dashboard's own spend card already carries for the same reason.
   */
  readonly unpricedCalls: number;
  /** How many were timed — the size of the sample {@link RouteStatsResource.latencyP50Ms} is the median of. */
  readonly timedCalls: number;
}

/**
 * What a matrix row reports when nothing in the window touched its kind.
 *
 * Two em-dashes and three honest zeros: *no calls were priced, none were unpriced, none were
 * timed*, which is a count of rows and not a claim about money. A shared constant because two
 * call sites need it and a second literal is a second chance to write `costCentsPerRunAvg: 0`.
 */
export const EMPTY_ROUTE_STATS: RouteStatsResource = {
  costCentsPerRunAvg: null,
  latencyP50Ms: null,
  pricedCalls: 0,
  unpricedCalls: 0,
  timedCalls: 0,
};

/** One route: the inspector's chain, its policy triple, and who last saved it. */
export interface RouteResource {
  /** `routes.id`. */
  readonly id: string;
  /** The kind this route answers for. */
  readonly taskKind: string;
  /** The pill the matrix prints and the inspector's title — `implement-primary`. */
  readonly tag: string;
  /** Mockup 06's **Allow fallback to local models** switch. */
  readonly allowLocalFallback: boolean;
  /**
   * Mockup 06's **Fail run instead of degrading below fallback N**, as the hop number, or
   * null for the switch being off.
   */
  readonly floorHopIndex: number | null;
  /** Mockup 06's **Max cost per run** in integer cents — `250` is `$2.50` — or null for no cap. */
  readonly maxCostCentsPerRun: number | null;
  /** The chain, primary first. Never empty for a route that exists. */
  readonly hops: readonly RouteHopResource[];
  /** The matrix's two numeric columns. See {@link RouteStatsResource}. */
  readonly stats: RouteStatsResource;
  /** When it was last saved, ISO 8601. */
  readonly updatedAt: string;
  /** Who last saved it — `"user".id` — or null for a route written by a seed, or by somebody since deleted. */
  readonly updatedBy: string | null;
}

/** One row of the matrix: a task kind, and the route it resolves through. */
export interface TaskKindResource {
  /** The mono label the row prints — `implement`. */
  readonly name: string;
  /** The grey line under it. */
  readonly description: string;
  /** The order the matrix draws the rows in; 1 is first. */
  readonly sortOrder: number;
  /**
   * The route, or **null** for a kind with none.
   *
   * V016 makes `routes.task_kind_id` unique but not mandatory, so a kind with no route is a
   * legal state and is a matrix row with an empty cell. Answering the row without the route
   * is what lets AA.6 draw that honestly rather than hiding a kind the workspace has.
   */
  readonly route: RouteResource | null;
}

/** One line of the **ESCALATION RULES** card. */
export interface EscalationRuleResource {
  /** `escalation_rules.id` — what the switch and the delete address. */
  readonly id: string;
  /** The card's switch. The card's `N active` is the count of these that are true. */
  readonly enabled: boolean;
  /** Evaluation order; 1 is first, and it is what gives *which rule wins* one answer. */
  readonly sortOrder: number;
  /** The predicate, structured (decision **M5**) — what the builder edits. */
  readonly when: EscalationWhen;
  /** The route modification, structured — likewise. */
  readonly then: EscalationThen;
  /**
   * The sentence the card renders — *"effort ≥ L → implement uses coder-max (max thinking)"*.
   *
   * **Generated by PostgreSQL and reported, never composed here**, and a client may not send
   * one: the column is `generated always … stored`, so the card, the matrix's escalation
   * column and the explanation panel print the same string because there is only one.
   */
  readonly display: string;
}

/**
 * The span every figure on this page was measured over — one window, published once.
 *
 * Carried on the payload rather than assumed by the client, because *30d* on the card and the
 * matrix's two columns are the same thirty days and a client that recomputed the boundary for
 * a label would eventually print a span the numbers were not measured over. `until` is the
 * instant the aggregation ran at, which a cached answer preserves rather than refreshes — see
 * `stats.cache.ts`.
 */
export interface StatsWindowResource {
  /** How many days wide — `30`. */
  readonly days: number;
  /** The oldest instant a counted call occurred at, ISO 8601. Inclusive. */
  readonly since: string;
  /** When the figures were measured, ISO 8601. */
  readonly until: string;
}

/**
 * One metered row of the **Spend by provider · 30d** card.
 *
 * A row is a provider *kind* as the ledger records one, except for the local row, which is the
 * mockup's *Local (vLLM + Ollama)* — see {@link ProviderSpendResource.local}.
 *
 * **`spendCents: 0` and `spendCents: null` are the two states this card exists to keep apart.**
 * Zero is a total over calls that were **priced, at nothing** — a local model on hardware the
 * workspace already owns — and it is the mockup's `$0.00`. Null is *nobody priced these calls*,
 * which renders as **unpriced** and never as a figure. Collapsing them is the failure DASH-J.4
 * ([#92](https://github.com/NobuData/ouroboros/issues/92)) exists to prevent, and the type is
 * what makes it unrepresentable: there is no member here meaning *unknown, treated as zero*.
 */
export interface ProviderSpendResource {
  /**
   * The row's identity, stable across reads — the kinds it sums, joined by `+`.
   *
   * `anthropic` for a cloud row, `ollama+openai_compatible` for the local one. Derived rather
   * than reserved, so no provider a workspace happens to record can collide with the local
   * row's name.
   */
  readonly key: string;
  /** The `token_usage.provider` values summed into this row — one, or both local kinds. */
  readonly kinds: readonly string[];
  /**
   * Whether this is the local row.
   *
   * The mockup draws vLLM and Ollama as **one** metered line, and they are merged here rather
   * than by the client for two reasons: the meters are widths relative to the largest row, so a
   * client that merged afterwards would be rescaling numbers it had already been given, and the
   * footnote's share is a fraction of exactly this row's tokens. Which kinds count as local is
   * `locality.ts`'s answer, borrowed from the AD.3 lease policy rather than restated.
   */
  readonly local: boolean;
  /**
   * The window's spend on this provider in cents, or **null** when none of its calls are priced.
   *
   * `41280` is the mockup's `$412.80`. See this interface's header on why `0` and `null` are
   * different facts.
   */
  readonly spendCents: number | null;
  /**
   * The meter's width, `0`–`1`, relative to the largest {@link ProviderSpendResource.spendCents}
   * on the card — or null when this row has nothing priced to draw.
   *
   * Served rather than left to the client because *relative to the maximum* is a property of
   * the whole card, and a row cannot compute it from itself. `0` is the honest width of a row
   * that really did cost nothing; the mockup's visible 2% sliver for the local row is a
   * minimum the stylesheet applies, not a number this service invents.
   */
  readonly meterFraction: number | null;
  /** `tokens_in + tokens_out` over the window — what the footnote's share is computed from. */
  readonly tokens: number;
  /** How many of this provider's calls carried a price. */
  readonly pricedCalls: number;
  /** How many did not. Non-zero makes {@link ProviderSpendResource.spendCents} a lower bound. */
  readonly unpricedCalls: number;
}

/**
 * The **Spend by provider · 30d** card, its footnote, and the window all of it was measured over.
 *
 * Served both inside {@link RoutingMatrixResource} — because the card and the matrix are one
 * screen, and two requests would let them disagree for as long as one was in flight — and on its
 * own at `GET /api/v1/routing/spend`, which is what AB.4
 * ([#210](https://github.com/NobuData/ouroboros/issues/210))'s full report reads. One shape and
 * one computation, so the card and the report cannot come to differ about an invoice.
 */
export interface RoutingSpendResource {
  /** The thirty days every figure below is over. */
  readonly window: StatsWindowResource;
  /**
   * The card's metered rows, largest spend first, the local row folded into one.
   *
   * Empty for a workspace that has spent nothing in the window — the card's zero-state. A
   * provider with no usage is **absent** rather than a row of zeros, for the reason a task kind
   * with no calls has no average: a zero drawn for work nobody did is a number, not an absence.
   */
  readonly providers: readonly ProviderSpendResource[];
  /**
   * Every row's priced spend added together, in cents, or null when nothing at all is priced.
   *
   * A lower bound whenever {@link RoutingSpendResource.unpricedCalls} is non-zero, which is
   * exactly what that count is published for.
   */
  readonly totalSpendCents: number | null;
  /** Every token the workspace spent in the window — the footnote's denominator. */
  readonly tokens: number;
  /** How many of them were served by a local provider — the footnote's numerator. */
  readonly localTokens: number;
  /**
   * The footnote — *"Local models served 31% of all tokens"* — as a **fraction** between 0 and 1.
   *
   * A fraction rather than a percentage, on `LoopPulse.mergeRate`'s precedent: where the digits
   * are grouped and how many survive rounding is the stylesheet's business. `0.31` is the
   * mockup's 31%.
   *
   * **Null when the window holds no tokens at all**, and `0` when it holds tokens and none of
   * them are local. Those are different sentences — *nothing ran* and *nothing ran locally* —
   * and only the first is an em-dash.
   */
  readonly localTokenShare: number | null;
  /** Calls in the window with no price, across every provider. Surfaced, never rounded away. */
  readonly unpricedCalls: number;
}

/** The whole page's read: the matrix, the rules card beside it, and the spend card under both. */
export interface RoutingMatrixResource {
  /** Every task kind, in `sort_order`. Empty for a workspace whose foundations are unseeded. */
  readonly taskKinds: readonly TaskKindResource[];
  /** Every rule, enabled and disabled alike, in evaluation order. */
  readonly rules: readonly EscalationRuleResource[];
  /**
   * The **Spend by provider · 30d** card, over the same window the matrix's numerics are.
   *
   * In this payload rather than behind a second request, for the reason the rules are: the
   * three cards are one screen, and the matrix's `$/run avg` and this card's totals are
   * aggregates over the same rows. Fetched apart they would be aggregates over the same rows
   * *at two instants*, which is a page that can show a call in one figure and not the other.
   */
  readonly spend: RoutingSpendResource;
}

/** One alias, as a swap menu offers it. */
export interface AliasResource {
  /** The name a route may use — `coder-max`. */
  readonly alias: string;
  /** What it resolves to, and the only place a raw model string appears (decision **M1**). */
  readonly modelId: string;
  /** The alias's own invocation defaults. `{}` is the ordinary state. */
  readonly params: Record<string, unknown>;
  /** Where it runs, or null for an alias with no connection bound yet. */
  readonly provider: RouteProviderResource | null;
}

/**
 * The registry read behind AA.3's swap menus.
 *
 * Unpaged, for the reason the health strip is: a workspace's registry is the handful of
 * aliases its routes name, and a page over a list that short would cost a client a second
 * request to discover there was nothing more.
 */
export interface AliasListResource {
  /** Every alias in the workspace, ordered by name, unbound ones included. */
  readonly aliases: readonly AliasResource[];
}

/** What one press of **Save routes** answers with. */
export interface SaveRoutesResource {
  /**
   * The `route_revisions` row this save wrote, or **null** when it changed nothing.
   *
   * Null is not a failure and not an omission — it is a client pressing **Save routes** on a
   * matrix it had not edited. V021 refuses an empty diff, so there is no row to name; see
   * `management.diff.ts` on why recording the press anyway would be an audit trail nobody
   * reads to the end.
   */
  readonly revisionId: string | null;
  /**
   * The routes as they now stand, in the order the request listed them.
   *
   * Re-read after the commit rather than echoed from the body, which is what makes the
   * ticket's *"round-trip through `PUT` and re-read identically"* a property of the answer
   * rather than a second request a client has to make to check.
   */
  readonly routes: readonly RouteResource[];
}

/**
 * The connection an alias is bound to, or null when it is not.
 *
 * Three columns are tested rather than one, exactly as `routing.rows.ts` does: the left join
 * makes all four null together and V015 makes all three non-null when the row exists, but the
 * *type* cannot say either, and a narrowing the compiler performs is worth more than a cast a
 * reader has to check.
 *
 * @param row - The joined row.
 * @returns The provider, or null for an unbound alias.
 */
export function toRouteProvider(row: AliasRow): RouteProviderResource | null {
  const { connection_id: id, kind, display_name: displayName } = row;

  return id !== null && kind !== null && displayName !== null
    ? { id, kind, displayName, baseUrl: row.base_url }
    : null;
}

/**
 * One hop as the contract publishes it.
 *
 * @param row - The joined hop.
 * @returns The hop.
 */
export function toRouteHopResource(row: ManagedHopRow): RouteHopResource {
  return {
    position: row.position,
    alias: row.alias,
    modelId: row.model_id,
    note: row.note,
    provider: toRouteProvider(row),
  };
}

/**
 * One route as the contract publishes it.
 *
 * @param route - The route row.
 * @param hops - Its chain, already in `position` order.
 * @param stats - What the window measured for this route's task kind, or
 *   {@link EMPTY_ROUTE_STATS} for a kind nothing touched. A **required** parameter rather than
 *   one defaulting to the empty value: a caller that forgot to pass measurements would
 *   otherwise publish em-dashes over a workspace that has them, which is the one failure mode
 *   of this field that nobody would notice.
 * @returns The route.
 */
export function toRouteResource(
  route: ManagedRouteRow,
  hops: readonly ManagedHopRow[],
  stats: RouteStatsResource,
): RouteResource {
  return {
    id: route.route_id,
    taskKind: route.task_kind,
    tag: route.tag,
    allowLocalFallback: route.allow_local_fallback,
    floorHopIndex: route.floor_hop_index,
    maxCostCentsPerRun: route.max_cost_cents_per_run,
    hops: hops.map(toRouteHopResource),
    stats,
    updatedAt: route.updated_at.toISOString(),
    updatedBy: route.updated_by,
  };
}

/**
 * One matrix row as the contract publishes it.
 *
 * @param kind - The task kind.
 * @param route - Its route, or null when it has none.
 * @returns The row.
 */
export function toTaskKindResource(
  kind: TaskKindRow,
  route: RouteResource | null,
): TaskKindResource {
  return {
    name: kind.name,
    description: kind.description,
    sortOrder: kind.sort_order,
    route,
  };
}

/**
 * One rule as the contract publishes it.
 *
 * @param row - The rule row, `display` included.
 * @returns The card's line.
 */
export function toEscalationRuleResource(row: ManagedRuleRow): EscalationRuleResource {
  return {
    id: row.id,
    enabled: row.enabled,
    sortOrder: row.sort_order,
    when: row.when,
    then: row.then,
    display: row.display,
  };
}

/**
 * One alias as a swap menu reads it.
 *
 * @param row - The joined alias.
 * @returns The menu entry, with its current resolution for preview.
 */
export function toAliasResource(row: AliasRow): AliasResource {
  return {
    alias: row.alias,
    modelId: row.model_id,
    params: row.params,
    provider: toRouteProvider(row),
  };
}
