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
 * **3. `stats` is present and null**, which is decision **M7** rather than a placeholder. The
 * matrix draws `$/run avg` and `p50 latency` per row, both computed from `token_usage` by Z.5
 * ([#198](https://github.com/NobuData/ouroboros/issues/198)); until that lands there is
 * nothing measured to report, and the rule is *no data → em-dash, never a fabricated number*.
 * Publishing the field as null now is what lets AA.2 render the em-dash today and the real
 * figure later without a contract change — and it is why `0` appears nowhere in this file as
 * a stand-in for *we did not measure this*.
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
 * Both are Z.5's ([#198](https://github.com/NobuData/ouroboros/issues/198)) to compute from
 * `token_usage` — which V020 gave a `task_kind` and a `latency_ms` for exactly this. Until it
 * lands they are null, and null is the answer decision **M7** requires: a workspace that has
 * run nothing has not spent `$0.00` per run, it has spent nothing anybody can average.
 */
export interface RouteStatsResource {
  /** The row's `$/run avg`, in cents, or null when no priced call has been attributed to this kind. */
  readonly costCentsPerRunAvg: number | null;
  /** The row's `p50 latency`, in milliseconds, or null when nothing timed a call for this kind. */
  readonly latencyP50Ms: number | null;
}

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

/** The whole page's read: the matrix, and the rules card beside it. */
export interface RoutingMatrixResource {
  /** Every task kind, in `sort_order`. Empty for a workspace whose foundations are unseeded. */
  readonly taskKinds: readonly TaskKindResource[];
  /** Every rule, enabled and disabled alike, in evaluation order. */
  readonly rules: readonly EscalationRuleResource[];
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
 * @returns The route, with `stats` honestly empty until Z.5 fills it.
 */
export function toRouteResource(
  route: ManagedRouteRow,
  hops: readonly ManagedHopRow[],
): RouteResource {
  return {
    id: route.route_id,
    taskKind: route.task_kind,
    tag: route.tag,
    allowLocalFallback: route.allow_local_fallback,
    floorHopIndex: route.floor_hop_index,
    maxCostCentsPerRun: route.max_cost_cents_per_run,
    hops: hops.map(toRouteHopResource),
    stats: { costCentsPerRunAvg: null, latencyP50Ms: null },
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
