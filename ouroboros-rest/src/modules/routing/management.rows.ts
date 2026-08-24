/**
 * The rows the management surface reads and the state it computes a save from.
 *
 * Z.2 ([#195](https://github.com/NobuData/ouroboros/issues/195)). The same seam
 * `routing.rows.ts` keeps for resolution, kept again for the editor and for the reason that
 * file gives: rows are snake_case because that is what `db/schema.ts` mirrors, and one file
 * holding the mapping is what stops an object literal at every call site from drifting from
 * the columns it is built out of.
 *
 * ---------------------------------------------------------------------------
 * **These are not resolution's rows, and the difference is what each is for.**
 *
 * `routing.rows.ts` reads *one* route in order to answer *what would run*. This reads *every*
 * route in order to draw a matrix and then to write one back, so three things differ:
 *
 *   * **the workspace's whole matrix in three statements**, not one route's chain in four —
 *     the page draws eight rows, and eight round trips to draw one table is the shape that
 *     turns a page load into a waterfall;
 *   * **the rules are read whole**, `enabled` and disabled alike. Resolution asks *which
 *     rules fire*; the card asks *which rules exist* and prints `3 active` from the
 *     difference. A read that filtered would make the count unrenderable;
 *   * **{@link RouteState} exists**, which resolution has no equivalent of. A save is a
 *     comparison between what a route *is* and what a body says it should be, and the diff
 *     that comparison produces is both what gets written to `route_revisions` and what
 *     decides which statements run at all.
 */

import type { EscalationThen, EscalationWhen } from "../db/schema";
import type { AliasRow } from "./routing.rows";

/** One row of the matrix, exactly as {@link RoutingManagementRepository.taskKinds} selects it. */
export interface TaskKindRow {
  /** `task_kinds.id`. */
  id: string;
  /** The mono label the matrix row prints — `implement`, `commit-msg`. */
  name: string;
  /** The grey line under it — *"Write the change, run tests, iterate to green"*. */
  description: string;
  /** The order the matrix draws the rows in; 1 is first. */
  sort_order: number;
}

/** One route with the name of the kind it answers for, as the management read selects it. */
export interface ManagedRouteRow {
  /** `routes.id`. */
  route_id: string;
  /** `task_kinds.name` — joined in, because every caller here has the name and not the id. */
  task_kind: string;
  /** The pill the matrix prints and the inspector's title — `implement-primary`. */
  tag: string;
  /** Mockup 06's local switch. */
  allow_local_fallback: boolean;
  /** The floor, or null for the switch being off. */
  floor_hop_index: number | null;
  /** The cap in cents, or null for a route with none. */
  max_cost_cents_per_run: number | null;
  /** Who last saved it — `"user".id`, or null. */
  updated_by: string | null;
  /** When it was last saved. */
  updated_at: Date;
}

/**
 * One hop of one chain, with its alias resolved as far as it goes.
 *
 * Extends {@link AliasRow} rather than redeclaring its seven columns, so the chain read and
 * the alias read cannot come to disagree about what an alias resolution is — including about
 * the column that is deliberately *not* in it. See `routing.repository.ts`'s header: a
 * resolution's opinion about whether a provider is usable is Z.3's snapshot and nothing
 * else's, and `provider_connections.status` selected here would be a second value to
 * disagree with it.
 */
export interface ManagedHopRow extends AliasRow {
  /** The route this hop belongs to — what the caller groups by. */
  route_id: string;
  /** Where in the chain it sits; 1 is the primary. Dense by V016's constraint trigger. */
  position: number;
  /** The operator's sentence for this hop, or null. */
  note: string | null;
}

/** One escalation rule, `enabled` or not — the card's row rather than resolution's. */
export interface ManagedRuleRow {
  id: string;
  /** The card's switch. */
  enabled: boolean;
  /** Evaluation order; 1 is first. */
  sort_order: number;
  /** The predicate. */
  when: EscalationWhen;
  /** The route modification. */
  then: EscalationThen;
  /** The sentence the card renders — the generated column, read rather than recomposed (**M5**). */
  display: string;
}

/** An alias's name and its id — what a save needs to turn `coder-max` into a `route_hops.model_alias_id`. */
export interface AliasIdRow {
  id: string;
  alias: string;
}

/** One hop as a save and a diff talk about it: a name and a note, with the position implied by the array. */
export interface HopState {
  /** `model_aliases.alias`. */
  alias: string;
  /** The operator's sentence, or null. */
  note: string | null;
}

/**
 * One route as it stands, in the vocabulary a save is expressed in.
 *
 * The *before* half of every comparison in `management.diff.ts`. Built from the rows above
 * rather than from a second query, because the matrix read has already fetched all of it —
 * re-reading a route to find out what it was would be a second answer to a question the page
 * load already asked.
 */
export interface RouteState {
  /** `routes.id` — what the save's statements are scoped by. */
  routeId: string;
  /** The kind this route answers for. */
  taskKind: string;
  /** **Allow fallback to local models**. */
  allowLocalFallback: boolean;
  /** The floor, or null for the switch being off. */
  floorHopIndex: number | null;
  /** The cap in cents, or null. */
  maxCostCentsPerRun: number | null;
  /** The chain, primary first. Never empty — V016's `route_chain_intact()` forbids it. */
  hops: readonly HopState[];
}

/**
 * One route as a body asks it to be.
 *
 * The *after* half. Structurally what {@link import("./routing.dto").RoutePolicyDto} carries,
 * declared separately so that the diff and the writer depend on a shape rather than on a
 * validation class — a pure function that imported a DTO would be a pure function that could
 * not be called without `class-validator`'s decorators having run.
 */
export interface DesiredRoute {
  /** The kind this entry edits. */
  taskKind: string;
  /** **Allow fallback to local models**. */
  allowLocalFallback: boolean;
  /** The floor, or null for off. */
  floorHopIndex: number | null;
  /** The cap in cents, or null for no cap. */
  maxCostCentsPerRun: number | null;
  /** The chain as the client now draws it, primary first. */
  hops: readonly HopState[];
}

/**
 * One route row as the editor reads it.
 *
 * @param route - The route.
 * @param hops - Its chain, already in `position` order.
 * @returns The state a save is compared against.
 */
export function toRouteState(route: ManagedRouteRow, hops: readonly ManagedHopRow[]): RouteState {
  return {
    routeId: route.route_id,
    taskKind: route.task_kind,
    allowLocalFallback: route.allow_local_fallback,
    floorHopIndex: route.floor_hop_index,
    maxCostCentsPerRun: route.max_cost_cents_per_run,
    hops: hops.map((hop) => ({ alias: hop.alias, note: hop.note })),
  };
}

/**
 * Group a workspace's hops by the route they belong to.
 *
 * One statement reads every chain and this splits them, rather than one statement per route:
 * eight round trips to draw one table is the shape that turns a page load into a waterfall.
 *
 * @param hops - Every hop of the workspace, already ordered by route and then by position.
 * @returns Route id to its chain, primary first. A route with no hops has no entry — which
 *   V016's `route_chain_intact()` makes unreachable, and the caller therefore treats an
 *   absent chain as the empty array rather than as a state to report.
 */
export function chainsByRoute(
  hops: readonly ManagedHopRow[],
): ReadonlyMap<string, readonly ManagedHopRow[]> {
  const chains = new Map<string, ManagedHopRow[]>();

  for (const hop of hops) {
    const chain = chains.get(hop.route_id);

    if (chain === undefined) {
      chains.set(hop.route_id, [hop]);
    } else {
      chain.push(hop);
    }
  }

  return chains;
}
