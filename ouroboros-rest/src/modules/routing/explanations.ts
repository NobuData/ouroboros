/**
 * The codes and the sentences — every reason this engine can give, in one file.
 *
 * Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194)). The ticket's hardest
 * requirement is not the chain walk, it is the word *silently* in mockup 06's promise: the
 * loop *"degrades gracefully when a provider stumbles — and never silently below the floor
 * you set."* A resolution that returns "no chain available" satisfies the algorithm and fails
 * the product, so every decision this module makes leaves both a `code` a client can branch
 * on and an `explanation` a person can read.
 *
 * ---------------------------------------------------------------------------
 * **The sentences are composed here so that no client composes one.**
 *
 * The acceptance criterion is that the inspector and the simulate panel render these
 * *without post-processing*. That is a claim about where the composition rule lives, and the
 * only way to keep it is to have one place it can live — the same trade `pricing/price.ts`'s
 * `display` and `provider-health/resources.ts`'s `chipMeta` already make in this service. A
 * second surface assembling its own sentence from the same fields is a second wording of the
 * same fact, and the two disagree the first time either is edited.
 *
 * **Two shapes, and the difference is deliberate.** A **kept** hop's explanation is the
 * inspector's hop-meta line — compact, `·`-separated, no terminal period, the shape mockup
 * 06 draws (*"Primary · API key valid, 42ms to us-east"*). Everything that **removes**
 * something — a dropped hop, a refused run, a rule that did not fire, the floor — is a
 * sentence ending in a period, because it has to say *what* and *why* and a meta line cannot.
 * `explanations.spec.ts` asserts both properties over every code, so a new reason cannot
 * arrive in the wrong shape.
 *
 * ---------------------------------------------------------------------------
 * **Codes are stable; sentences are not.** Wording gets better and a client that branched on
 * it would break when it did. That is the whole reason both exist, and it is why the codes
 * are `as const` objects rather than free strings — a misspelt code should not compile.
 */

import type { ProviderConnectionStatus } from "../db/schema";
import { META_SEPARATOR } from "../provider-health/resources";

/**
 * What a hop's decision can be, as codes.
 *
 * Six of the eight remove a hop. The two that keep one are still codes rather than a bare
 * `kept`, because *usable* and *nothing has checked it* are different claims and decision
 * **M8** insists the second is never rendered as the first.
 */
export const HOP_CODES = {
  /** Kept — its provider answered a check and is usable. */
  healthy: "provider_healthy",
  /** Kept — nothing has checked this provider yet, which is not evidence that it is down. */
  unchecked: "provider_unknown",
  /** Dropped — an operator paused this provider. */
  paused: "provider_paused",
  /** Dropped — a check found this provider unusable. */
  unreachable: "provider_error",
  /** Dropped — the alias names no provider connection (V019's unbound state). */
  unbound: "alias_unbound",
  /** Dropped — the hop sits deeper than this route's floor. */
  belowFloor: "below_floor",
  /** Dropped — a `route_local` rule fired and this hop is not on a local provider. */
  notLocal: "rule_route_local",
  /** Dropped — this route does not allow local models and this hop is on one. */
  localNotAllowed: "local_not_allowed",
} as const;

/** One hop decision's code. */
export type HopCode = (typeof HOP_CODES)[keyof typeof HOP_CODES];

/** The codes that keep a hop, as values — the complement of every code that drops one. */
export const KEPT_HOP_CODES = [HOP_CODES.healthy, HOP_CODES.unchecked] as const;

/** What a matched escalation rule did, or why it did nothing. */
export const RULE_CODES = {
  /** Applied — the rule's alias was already the primary, so only its params moved. */
  paramsMerged: "use_alias_params_merged",
  /** Applied — the rule's alias was already in the chain and was moved to the front. */
  swapped: "use_alias_swapped",
  /** Applied — the rule's alias was not in the chain and became a new primary. */
  prepended: "use_alias_prepended",
  /** Applied — a second opinion was attached to the resolution. */
  voteAdded: "add_vote_added",
  /** Applied — the chain was filtered to local providers. */
  routedLocal: "route_local_applied",
  /** Not applied — the rule modifies a different task kind. */
  otherTaskKind: "not_this_task_kind",
  /** Not applied — the alias the rule names is missing or unbound. */
  aliasUnresolvable: "alias_unresolvable",
  /** Not applied — that vote is already on this resolution. */
  voteAlreadyAdded: "vote_already_added",
} as const;

/** One matched rule's outcome code. */
export type RuleOutcomeCode = (typeof RULE_CODES)[keyof typeof RULE_CODES];

/** The codes that mean a rule changed the resolution. */
export const APPLIED_RULE_CODES = [
  RULE_CODES.paramsMerged,
  RULE_CODES.swapped,
  RULE_CODES.prepended,
  RULE_CODES.voteAdded,
  RULE_CODES.routedLocal,
] as const;

/** What the floor decided — recorded on every resolution, including the ones it did not touch. */
export const FLOOR_CODES = {
  /** No floor is configured — mockup 06's switch is off. */
  none: "no_floor",
  /** A floor is configured and the resolution did not have to be refused because of it. */
  held: "floor_held",
  /** A floor is configured and nothing at or above it is usable — the run is refused. */
  breached: "floor_breached",
} as const;

/** The floor's decision code. */
export type FloorCode = (typeof FLOOR_CODES)[keyof typeof FLOOR_CODES];

/**
 * Why a resolution refuses to produce a chain.
 *
 * {@link RESOLUTION_FAILURE_CODES.floorBreached} deliberately shares its string with
 * {@link FLOOR_CODES.breached}: they are the same fact stated in two places, and giving the
 * failure a second spelling would make a client check both.
 */
export const RESOLUTION_FAILURE_CODES = {
  /** Every hop at or above the floor was dropped, and the route says fail rather than degrade. */
  floorBreached: "floor_breached",
  /** Nothing in the chain is usable, and no floor is what stopped it. */
  noEligibleHop: "no_eligible_hop",
} as const;

/** One refusal's code. */
export type ResolutionFailureCode =
  (typeof RESOLUTION_FAILURE_CODES)[keyof typeof RESOLUTION_FAILURE_CODES];

/**
 * What a sentence needs to know about a provider.
 *
 * Structural rather than an import of `ResolvedProvider`, so this module depends on nothing
 * in `resolution.ts` and the dependency between the two runs one way. A cycle between a shape
 * and the vocabulary its fields are typed from is the kind that compiles and then fails
 * `depcruise`; declaring the three fields a sentence reads is cheaper than discovering that.
 */
export interface ProviderFacts {
  /** What the inspector prints — `Anthropic Claude`, `GitHub Copilot`, `Ollama · workstation`. */
  readonly displayName: string;
  /** Whether it is usable, as far as anything knows. */
  readonly status: ProviderConnectionStatus;
  /** The last measured latency, or null when nothing measured one. Never 0 as a stand-in. */
  readonly latencyMs: number | null;
  /** Why it is in this state, when there is something to say — `elevated latency`, `503 upstream`. */
  readonly detail: string | null;
}

/**
 * What a hop is called in a sentence — `Primary`, `Fallback 1`.
 *
 * Counted from the **resolved** chain rather than from `route_hops.position`, because it is
 * what the inspector's rail prints beside the hop a reader is looking at. The floor's own
 * sentences name a *hop number* instead, for the reason `resolve.ts` gives: the floor is a
 * statement about the stored chain and must not be renumbered by a rule that prepends.
 *
 * @param index - The hop's 1-based place in the resolved chain.
 * @returns `Primary` for the first hop, `Fallback N` for the rest.
 */
export function hopRole(index: number): string {
  return index <= 1 ? "Primary" : `Fallback ${(index - 1).toString()}`;
}

/**
 * How a provider is doing, in a phrase.
 *
 * Composed from the parts that exist rather than by a branch per provider — the rule
 * `provider-health/resources.ts` established for the health strip, and the separator is
 * literally that module's, so a hop's line and a chip's line are punctuated the same way.
 *
 * @param provider - The connection and what is known about it.
 * @returns The phrase — `healthy · 42ms`, `not checked yet`, `unreachable · 503 upstream`.
 */
export function healthPhrase(provider: ProviderFacts): string {
  const state: Record<ProviderConnectionStatus, string> = {
    active: "healthy",
    // Decision M8, in one word: nothing has looked, and that is not the same as *up*.
    unknown: "not checked yet",
    paused: "paused by an operator",
    error: "unreachable",
  };

  const parts = [
    state[provider.status],
    // A latency belongs beside a state the latency was measured for. A paused provider's last
    // measurement is a fact about a check nobody is repeating, and printing it beside "paused"
    // reads as a live number.
    provider.status === "active" && provider.latencyMs !== null
      ? `${provider.latencyMs.toString()}ms`
      : null,
    provider.detail,
  ].filter((part): part is string => part !== null);

  return parts.join(META_SEPARATOR);
}

/**
 * The meta line for a hop the executor will try.
 *
 * The mockup's shape — no terminal period, see this file's header.
 *
 * @param index - The hop's 1-based place in the resolved chain.
 * @param provider - Where it runs.
 * @returns `Primary · healthy · 42ms`, `Fallback 2 · not checked yet`.
 */
export function keptHopExplanation(index: number, provider: ProviderFacts): string {
  return `${hopRole(index)}${META_SEPARATOR}${healthPhrase(provider)}`;
}

/**
 * The sentence for a hop that was dropped, whatever dropped it.
 *
 * One function over every dropping code rather than one per code, so that a code added to
 * {@link HOP_CODES} without a sentence fails to compile here instead of rendering as an empty
 * meta line somebody notices in a screenshot.
 *
 * @param code - Why it was dropped.
 * @param index - The hop's 1-based place in the resolved chain.
 * @param alias - The alias the hop names, for the codes whose sentence is about the name.
 * @param provider - Where it would have run, or null for an unbound alias.
 * @param floorHopIndex - The route's floor, for the code whose sentence quotes it.
 * @returns The sentence.
 */
export function droppedHopExplanation(
  code: HopCode,
  index: number,
  alias: string,
  provider: ProviderFacts | null,
  floorHopIndex: number | null,
): string {
  const role = hopRole(index);
  const name = provider === null ? alias : provider.displayName;
  const because = provider === null || provider.detail === null ? "" : ` (${provider.detail})`;

  switch (code) {
    case HOP_CODES.unbound:
      return `${role} dropped — the alias ${alias} is not bound to a provider connection.`;
    case HOP_CODES.belowFloor:
      return (
        `${role} dropped — this route may not degrade below hop ` +
        `${(floorHopIndex ?? 0).toString()}.`
      );
    case HOP_CODES.notLocal:
      return (
        `${role} dropped — an escalation rule routes this run to local providers, ` +
        `and ${name} is not one.`
      );
    case HOP_CODES.localNotAllowed:
      return `${role} dropped — this route does not allow local models, and ${name} is one.`;
    case HOP_CODES.paused:
      return `${role} dropped — ${name} is paused by an operator${because}.`;
    case HOP_CODES.unreachable:
      return `${role} dropped — ${name} is unreachable${because}.`;
    // The two kept codes reach here only if a caller passed one, which is a bug in the caller
    // rather than a state of the world. Answering with the meta line keeps the field
    // renderable instead of empty, and `resolve.ts` never takes this path.
    case HOP_CODES.healthy:
    case HOP_CODES.unchecked:
      return provider === null ? `${role} dropped.` : keptHopExplanation(index, provider);
  }
}

/**
 * The sentence for what the floor decided.
 *
 * @param code - Its decision.
 * @param floorHopIndex - The route's floor, or null when none is set.
 * @param droppedBelow - How many hops were dropped for sitting below it.
 * @returns The sentence.
 */
export function floorExplanation(
  code: FloorCode,
  floorHopIndex: number | null,
  droppedBelow: number,
): string {
  if (code === FLOOR_CODES.none || floorHopIndex === null) {
    return "No floor is set — this route may degrade to the end of its chain.";
  }

  const floor = `The floor is hop ${floorHopIndex.toString()}`;

  if (code === FLOOR_CODES.breached) {
    return (
      `${floor} — no hop at or above it is usable, so this run fails ` +
      "rather than degrading below it."
    );
  }

  if (droppedBelow === 0) {
    return `${floor} — nothing in this chain sits below it.`;
  }

  const hops =
    droppedBelow === 1 ? "1 deeper hop was" : `${droppedBelow.toString()} deeper hops were`;

  return `${floor} — this route may not degrade below it, so ${hops} dropped.`;
}

/**
 * The sentence for a resolution that refuses to produce a chain.
 *
 * @param code - Which refusal.
 * @param routeTag - The route's tag, so the sentence names what failed.
 * @param floorHopIndex - The route's floor, for the refusal that quotes it.
 * @returns The sentence.
 */
export function failureExplanation(
  code: ResolutionFailureCode,
  routeTag: string,
  floorHopIndex: number | null,
): string {
  if (code === RESOLUTION_FAILURE_CODES.floorBreached) {
    return floorExplanation(FLOOR_CODES.breached, floorHopIndex, 0);
  }

  return `No hop in ${routeTag} is usable, so this run fails rather than guessing.`;
}

/**
 * The sentence for what a matched escalation rule did.
 *
 * @param code - Its outcome.
 * @param alias - The alias its `"then"` names, or null for `route_local`, which names none.
 * @param ruleTaskKind - The kind its `"then"` modifies, or null for `route_local`.
 * @param taskKind - The kind being resolved, for the near-miss sentence that contrasts them.
 * @returns The sentence.
 */
export function ruleExplanation(
  code: RuleOutcomeCode,
  alias: string | null,
  ruleTaskKind: string | null,
  taskKind: string,
): string {
  const name = alias ?? "this rule's alias";

  switch (code) {
    case RULE_CODES.paramsMerged:
      return (
        `Applied — ${name} is already the primary, and the rule's parameters ` +
        "were merged over the alias's."
      );
    case RULE_CODES.swapped:
      return `Applied — ${name} was moved to the front of the chain.`;
    case RULE_CODES.prepended:
      return `Applied — ${name} was prepended as the primary.`;
    case RULE_CODES.voteAdded:
      return `Applied — a ${name} vote was added for the executor to obtain.`;
    case RULE_CODES.routedLocal:
      return "Applied — the chain was filtered to local providers.";
    case RULE_CODES.otherTaskKind:
      return (
        `Not applied — this rule modifies ${ruleTaskKind ?? "another task kind"}, ` +
        `and this resolution is for ${taskKind}.`
      );
    case RULE_CODES.aliasUnresolvable:
      return (
        `Not applied — this workspace has no alias named ${name} ` +
        "bound to a provider connection."
      );
    case RULE_CODES.voteAlreadyAdded:
      return `Not applied — a ${name} vote is already on this resolution.`;
  }
}
