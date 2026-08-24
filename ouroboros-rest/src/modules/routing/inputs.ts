/**
 * Everything `resolve()` is given — the pure inputs, in the service's vocabulary.
 *
 * Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194)). The ticket's last acceptance
 * criterion is that *the function performs no network I/O — health arrives as a snapshot
 * input*, and this file is what that criterion looks like as types: a route, its ordered hops,
 * the aliases a rule might name, the enabled rules, a health snapshot, and a context. Six
 * values, none of them a client, a pool or a clock.
 *
 * That is not a testing convenience, it is what makes **Simulate routing** honest. A
 * simulator that called out to check a provider would be a second code path with a second set
 * of failure modes; a simulator that is handed the same snapshot the executor would be handed
 * is *production behaviour minus the network call*, which is decision **M6** stated as a
 * signature.
 *
 * ---------------------------------------------------------------------------
 * **Names are camelCase here and snake_case in `db/schema.ts`.** `routing.rows.ts` is the one
 * crossing point, for the reason `registry/resolution.ts` gives: a mapper whose input type
 * lives somewhere else is a mapper that can drift from what it maps.
 */

import type { EscalationThen, EscalationWhen, ProviderConnectionKind } from "../db/schema";
import type { ProviderHealthSnapshot } from "../provider-health/snapshot";
import type { ResolutionContext } from "./context";

/**
 * One route's policy triple and the two names that identify it — mockup 06's inspector
 * header and its three controls.
 */
export interface RouteSpec {
  /** The kind this route answers for — `task_kinds.name`. */
  readonly taskKind: string;
  /** The route's tag — `implement-primary`. */
  readonly tag: string;
  /** **Allow fallback to local models**. */
  readonly allowLocalFallback: boolean;
  /**
   * **Fail run instead of degrading below fallback N** — the deepest *stored* hop position
   * this route may run on, or null for the switch being off.
   */
  readonly floorHopIndex: number | null;
  /** **Max cost per run**, in cents, or null for a route with no cap. */
  readonly maxCostCents: number | null;
}

/**
 * The connection an alias is bound to — the four identifying facts, and no health.
 *
 * Health is deliberately absent and arrives separately as a snapshot: two sources for *is
 * this provider up* is one source too many, and the one that is a **pure input** is the one
 * a matrix test can drive. `routing.repository.ts`'s chain statement therefore does not select
 * `provider_connections.status` at all, which is asserted rather than promised.
 */
export interface AliasBinding {
  /** The connection's id — the key a health snapshot is found by. */
  readonly connectionId: string;
  /** Which adapter reaches it, and therefore whether the hop is local. */
  readonly kind: ProviderConnectionKind;
  /** What the inspector prints — `Anthropic Claude`, `Ollama · workstation`. */
  readonly displayName: string;
  /** Where it is, or null for a kind reached at its vendor's own endpoint. */
  readonly baseUrl: string | null;
}

/**
 * One alias, as far as the registry can resolve it.
 *
 * {@link AliasSpec.binding} is null for V019's **unbound** state — a name created ahead of its
 * key, which mockup 21 draws as a first-class row. Resolution treats it as a hop it cannot
 * use and says so; the fuller disabled/unbound semantics are CH.6's
 * ([#589](https://github.com/NobuData/ouroboros/issues/589)) to add on top of this seam.
 */
export interface AliasSpec {
  /** The name a route or a rule uses — `coder-max`. */
  readonly alias: string;
  /** The raw provider model string it means, and the only place one appears (decision **M1**). */
  readonly modelId: string;
  /** The alias's own invocation defaults. `{}` is the ordinary state. */
  readonly params: Record<string, unknown>;
  /** Where it runs, or null when nothing is bound. */
  readonly binding: AliasBinding | null;
}

/** One stored hop of the chain — a position, an operator's note, and the alias it names. */
export interface ChainHopSpec {
  /** `route_hops.position` — dense from 1 by constraint, which is what the floor counts. */
  readonly position: number;
  /** The operator's sentence for this hop, or null. */
  readonly note: string | null;
  /** What the hop resolves to. */
  readonly target: AliasSpec;
}

/** One enabled escalation rule, in the shape M5 stores it. */
export interface RuleSpec {
  /** The row's id. */
  readonly id: string;
  /** Its evaluation order; 1 is first. */
  readonly sortOrder: number;
  /** The card's sentence, from the generated column — reported, never recomposed. */
  readonly display: string;
  /** The predicate. */
  readonly when: EscalationWhen;
  /** The route modification. */
  readonly then: EscalationThen;
}

/**
 * A hop while the rules are still being applied to it.
 *
 * Not part of the answer — {@link import("./resolution").ResolutionHop} is — and it exists
 * because a rule may move a hop, prepend one, or change one's params before anything has
 * decided whether the hop is usable. {@link PlannedHop.position} is null for a hop a rule
 * prepended, which is the fact the floor is measured against.
 */
export interface PlannedHop {
  /** `route_hops.position`, or null for a hop an escalation rule prepended. */
  readonly position: number | null;
  /** The operator's note, or null. A prepended hop has none: nobody wrote it. */
  readonly note: string | null;
  /** What the hop resolves to. */
  readonly target: AliasSpec;
  /** The alias's params with any applied rule's merged over them. Sorted keys. */
  readonly params: Record<string, unknown>;
}

/**
 * Everything one resolution is computed from.
 *
 * Given the same value twice, `resolve()` answers the same object twice — byte for byte,
 * which `resolve.spec.ts` asserts through `JSON.stringify` rather than through a deep-equality
 * matcher, because key order is part of what a consumer pins.
 */
export interface ResolutionInput {
  /** The route and its policies. */
  readonly route: RouteSpec;
  /** Its hops, in `position` order. Never empty — V016's `route_chain_intact()` forbids it. */
  readonly hops: readonly ChainHopSpec[];
  /**
   * Every alias in the workspace, resolved.
   *
   * Needed because a rule may name an alias that is **not in this chain** — the mockup's
   * `second-opinion` is in no route's chain at all — so the chain alone cannot satisfy a
   * `use_alias` or an `add_vote`.
   */
  readonly aliases: readonly AliasSpec[];
  /** The workspace's enabled rules, in `sort_order`. */
  readonly rules: readonly RuleSpec[];
  /** Z.3's snapshots — the only thing here that says whether a provider is usable. */
  readonly health: readonly ProviderHealthSnapshot[];
  /** What is known about the work being routed. */
  readonly context: ResolutionContext;
}
