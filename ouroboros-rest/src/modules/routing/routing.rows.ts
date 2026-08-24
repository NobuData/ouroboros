/**
 * Rows in, inputs out — the one crossing point between the database's vocabulary and
 * resolution's.
 *
 * Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194)). The same seam
 * `registry/resolution.ts` and `provider-health/snapshot.ts` both keep, and for the reason
 * both of them state: rows are snake_case because that is what `db/schema.ts` mirrors, the
 * inputs `resolve()` reads are camelCase because that is what the rest of the service speaks,
 * and putting the mapping in one file is what stops an object literal at every call site from
 * drifting from the columns it is built out of.
 *
 * ---------------------------------------------------------------------------
 * **The alias join is a LEFT join, and this file is where the null it admits is handled.**
 *
 * `registry/registry.repository.ts` resolves aliases through an `innerJoin`, which is right
 * for the registry: an unbound alias resolves to nothing, so the row is not an answer. It is
 * wrong for a *chain*, because a chain has a fixed length an operator configured — dropping
 * the row would make a three-hop chain silently arrive as two, which is exactly the silence
 * this ticket exists to remove. So the hop arrives with a null binding, and `resolve()` drops
 * it with a stated reason instead.
 *
 * **No row here carries `provider_connections.status`**, and that is the second reason these
 * types are not `registry/resolution.ts`'s. A resolution's opinion about whether a provider is
 * usable comes from Z.3's health snapshot and from nowhere else; a status selected here would
 * be a second value to disagree with it, and the disagreement would surface as a chain that
 * skipped a hop the strip drew green.
 */

import type { EscalationThen, EscalationWhen, ProviderConnectionKind } from "../db/schema";
import type { AliasSpec, ChainHopSpec, RouteSpec, RuleSpec } from "./inputs";

/** One route, exactly as {@link RoutingRepository.route} selects it. */
export interface RouteRow {
  /** The route's id — what the hops statement is scoped by. */
  route_id: string;
  /** `implement-primary`. */
  tag: string;
  /** Mockup 06's local switch. */
  allow_local_fallback: boolean;
  /** The floor, or null for the switch being off. */
  floor_hop_index: number | null;
  /** The cap in cents, or null for a route with none. */
  max_cost_cents_per_run: number | null;
}

/** One alias with its connection left-joined — null in all four connection columns when unbound. */
export interface AliasRow {
  alias: string;
  model_id: string;
  params: Record<string, unknown>;
  connection_id: string | null;
  kind: ProviderConnectionKind | null;
  display_name: string | null;
  base_url: string | null;
}

/** One hop of a chain: an alias row, plus where it sits and what an operator wrote about it. */
export interface ChainHopRow extends AliasRow {
  position: number;
  note: string | null;
}

/** One enabled escalation rule, exactly as {@link RoutingRepository.rules} selects it. */
export interface EscalationRuleRow {
  id: string;
  sort_order: number;
  display: string;
  when: EscalationWhen;
  then: EscalationThen;
}

/**
 * One alias row as resolution reads it.
 *
 * The binding is null when the alias is **unbound** — V019's state for a name created ahead of
 * its key. Three columns are tested rather than one: the left join makes all four null
 * together and V015 makes all three non-null when the row exists, but the *type* cannot say
 * either, and a narrowing the compiler performs is worth more than a cast a reader has to
 * check. There is no state in which the three disagree, so there is no fourth branch.
 *
 * @param row - The joined row.
 * @returns The alias, with a binding or without one.
 */
export function toAliasSpec(row: AliasRow): AliasSpec {
  const { connection_id: connectionId, kind, display_name: displayName } = row;

  return {
    alias: row.alias,
    modelId: row.model_id,
    params: row.params,
    binding:
      connectionId !== null && kind !== null && displayName !== null
        ? { connectionId, kind, displayName, baseUrl: row.base_url }
        : null,
  };
}

/**
 * One hop row as resolution reads it.
 *
 * @param row - The joined row.
 * @returns The hop.
 */
export function toChainHop(row: ChainHopRow): ChainHopSpec {
  return { position: row.position, note: row.note, target: toAliasSpec(row) };
}

/**
 * One route row as resolution reads it.
 *
 * @param row - The route.
 * @param taskKind - The kind that was asked for. Carried in rather than selected, because the
 *   caller has it: it is the argument `resolve` was called with, and echoing it from the row
 *   would only prove the join matched.
 * @returns The route and its policies.
 */
export function toRouteSpec(row: RouteRow, taskKind: string): RouteSpec {
  return {
    taskKind,
    tag: row.tag,
    allowLocalFallback: row.allow_local_fallback,
    floorHopIndex: row.floor_hop_index,
    maxCostCents: row.max_cost_cents_per_run,
  };
}

/**
 * One rule row as resolution reads it.
 *
 * @param row - The rule.
 * @returns The rule, with its generated sentence carried through unchanged.
 */
export function toRuleSpec(row: EscalationRuleRow): RuleSpec {
  return {
    id: row.id,
    sortOrder: row.sort_order,
    display: row.display,
    when: row.when,
    then: row.then,
  };
}
