/**
 * `resolve()` — the one pure, versioned, health-aware function decision **M6** asks for.
 *
 * Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194)). Everything mockup 06
 * promises about routing happens in this file, in the order the ticket states it: load, apply
 * the rules, walk the chain, enforce the policies, annotate every decision, attach the cost
 * cap, stamp the version. The load is `resolution.service.ts`'s — by the time anything here
 * runs, the inputs are values.
 *
 * ---------------------------------------------------------------------------
 * **Nothing here reads a clock, a pool, a socket or a random number.** That is what makes
 * **Simulate routing** (Z.4, [#197](https://github.com/NobuData/ouroboros/issues/197)) the
 * *same* function rather than a parallel mock, and it is why the acceptance criteria can be
 * written as a matrix: rules × health × floor × local policy × cost is a table of inputs to
 * one function, not a set of scenarios to stage.
 *
 * ---------------------------------------------------------------------------
 * **The order the drop reasons are tested in is a product decision, not an implementation
 * detail.**
 *
 * A hop can be droppable for more than one reason at once — a paused local provider on a
 * route with local turned off is two — and the reason reported is the first that applies.
 * Policy is tested before health, deliberately: a hop the route's own configuration excludes
 * is not in play whatever any provider is doing, and an operator asking *why is hop 3 not
 * being used* should be told about the floor they set rather than about a latency that would
 * not have mattered. Within policy, the order is unbound → floor → `route_local` → local
 * fallback, which runs from *this hop cannot resolve at all* outwards to *this route will not
 * use it today*.
 *
 * ---------------------------------------------------------------------------
 * **The floor is measured against `route_hops.position`, never against the resolved index.**
 *
 * An operator sets *"fail instead of degrading below fallback 2"* while looking at the chain
 * the inspector drew, so the number they chose refers to that chain's numbering. A
 * `use_alias` rule that prepends a primary shifts every resolved index by one; if the floor
 * followed the resolved index it would quietly become one hop shallower whenever a rule
 * fired, which is a policy changing itself. A prepended hop has no stored position and is
 * therefore never below the floor — it sits above the whole configured chain, which is what
 * *prepend* means.
 *
 * ---------------------------------------------------------------------------
 * **A floor breach produces a refusal, never a shorter chain.** The distinction is the
 * ticket's and it is the whole point of the policy: *the run may not proceed* and *the run
 * proceeds on the third fallback* are different outcomes, and a resolution that quietly
 * returned the survivors would have turned the first into the second.
 */

import { FLOOR_CODES, HOP_CODES, KEPT_HOP_CODES } from "./explanations";
import {
  droppedHopExplanation,
  failureExplanation,
  floorExplanation,
  keptHopExplanation,
  RESOLUTION_FAILURE_CODES,
  type FloorCode,
  type HopCode,
} from "./explanations";
import type { AliasBinding, PlannedHop, ResolutionInput } from "./inputs";
import { isLocalProvider } from "./locality";
import {
  RESOLUTION_VERSION,
  type Resolution,
  type ResolutionFailure,
  type ResolutionHop,
  type ResolvedProvider,
  type VoteRequirement,
} from "./resolution";
import { applyRules, matchedRules, sortParams } from "./rules";
import type { ProviderHealthSnapshot } from "../provider-health/snapshot";

/** The hop codes that keep a hop, as a set — the walk's one membership test. */
const KEPT = new Set<HopCode>(KEPT_HOP_CODES);

/** The route policies a hop is tested against, gathered so the test reads as one statement. */
interface HopPolicy {
  /** The deepest stored position this route may run on, or null. */
  readonly floorHopIndex: number | null;
  /** Whether local hops are permitted at all. */
  readonly allowLocalFallback: boolean;
  /** Whether a `route_local` rule fired for this resolution. */
  readonly routeLocal: boolean;
}

/**
 * A binding plus whatever the health snapshot says about it.
 *
 * The **only** place a provider's status enters a resolution. `routing.repository.ts`
 * deliberately does not select `provider_connections.status`, so there is no second value
 * this could disagree with.
 *
 * @param binding - Where the alias runs, or null when it is unbound.
 * @param health - The snapshots, keyed by connection id.
 * @returns The provider, or null for an unbound alias. A bound connection with no snapshot
 *   reports `unknown` — decision **M8**: nothing has looked, which is not the same as *up*,
 *   and is also not a reason to drop the hop.
 */
function providerOf(
  binding: AliasBinding | null,
  health: ReadonlyMap<string, ProviderHealthSnapshot>,
): ResolvedProvider | null {
  if (binding === null) {
    return null;
  }

  const snapshot = health.get(binding.connectionId);

  return {
    id: binding.connectionId,
    kind: binding.kind,
    displayName: binding.displayName,
    baseUrl: binding.baseUrl,
    status: snapshot?.status ?? "unknown",
    latencyMs: snapshot?.measured.latencyMs ?? null,
    detail: snapshot?.measured.detail ?? null,
  };
}

/**
 * Why this hop is kept, or why it is not.
 *
 * See this file's header for why the tests are in this order.
 *
 * @param provider - Where the hop runs, or null when its alias is unbound.
 * @param position - Its stored position, or null for a hop a rule prepended.
 * @param policy - The route's policies and whether a `route_local` rule fired.
 * @returns The code. Exactly one, and the first that applies.
 */
function hopCode(
  provider: ResolvedProvider | null,
  position: number | null,
  policy: HopPolicy,
): HopCode {
  if (provider === null) {
    return HOP_CODES.unbound;
  }

  if (policy.floorHopIndex !== null && position !== null && position > policy.floorHopIndex) {
    return HOP_CODES.belowFloor;
  }

  const local = isLocalProvider(provider.kind);

  if (policy.routeLocal && !local) {
    return HOP_CODES.notLocal;
  }

  if (!policy.allowLocalFallback && local) {
    return HOP_CODES.localNotAllowed;
  }

  if (provider.status === "paused") {
    return HOP_CODES.paused;
  }

  if (provider.status === "error") {
    return HOP_CODES.unreachable;
  }

  return provider.status === "unknown" ? HOP_CODES.unchecked : HOP_CODES.healthy;
}

/**
 * One planned hop, decided and annotated.
 *
 * @param hop - The hop after the rules have had their say.
 * @param index - Its 1-based place in the resolved chain, dropped hops included.
 * @param health - The snapshots, keyed by connection id.
 * @param policy - The route's policies.
 * @returns The hop as the resolution publishes it.
 */
function walkHop(
  hop: PlannedHop,
  index: number,
  health: ReadonlyMap<string, ProviderHealthSnapshot>,
  policy: HopPolicy,
): ResolutionHop {
  const provider = providerOf(hop.target.binding, health);
  const code = hopCode(provider, hop.position, policy);
  const kept = KEPT.has(code);

  return {
    index,
    position: hop.position,
    alias: hop.target.alias,
    modelId: hop.target.modelId,
    params: hop.params,
    provider,
    note: hop.note,
    decision: kept ? "kept" : "dropped",
    explanation:
      kept && provider !== null
        ? keptHopExplanation(index, provider)
        : droppedHopExplanation(code, index, hop.target.alias, provider, policy.floorHopIndex),
    code,
  };
}

/**
 * Resolve a task kind's route against a health snapshot and a context.
 *
 * Deterministic: the same input produces the same object, byte for byte through
 * `JSON.stringify` — every array is built in a fixed order and every params object has sorted
 * keys.
 *
 * @param input - The route, its hops, the workspace's aliases and rules, the health snapshot,
 *   and what is known about the work. See `inputs.ts`.
 * @returns The resolution: an ordered chain with every hop annotated, the rules that matched,
 *   any votes attached, the floor's decision, the cost cap, and either an outcome of
 *   `resolved` or a `fail_run` carrying its reason.
 */
export function resolve(input: ResolutionInput): Resolution {
  const health = new Map(input.health.map((snapshot) => [snapshot.connectionId, snapshot]));

  // Sorted here rather than at the merge alone, so a hop no rule touched serialises the same
  // way as one a rule did. Determinism has to hold across the whole array, not per element.
  const planned: PlannedHop[] = input.hops.map((hop) => ({
    position: hop.position,
    note: hop.note,
    target: hop.target,
    params: sortParams(hop.target.params),
  }));

  const application = applyRules(
    planned,
    matchedRules(input.rules, input.context),
    input.aliases,
    input.route.taskKind,
  );

  const policy: HopPolicy = {
    floorHopIndex: input.route.floorHopIndex,
    allowLocalFallback: input.route.allowLocalFallback,
    routeLocal: application.routeLocal,
  };

  const chain = application.chain.map((hop, offset) => walkHop(hop, offset + 1, health, policy));

  const usable = chain.some((hop) => hop.decision === "kept");
  const droppedBelowFloor = chain.filter((hop) => hop.code === HOP_CODES.belowFloor).length;

  // A breach is *the floor is why nothing is usable*: a hop the run could otherwise have
  // degraded to exists, and the policy is what forbade it. With no such hop the chain simply
  // has nothing left, which is a different failure and gets a different code — an operator
  // told "the floor stopped this" when no floor was involved would go and change a switch
  // that was never the problem.
  const breached = !usable && input.route.floorHopIndex !== null && droppedBelowFloor > 0;

  const floorCode: FloorCode = breached
    ? FLOOR_CODES.breached
    : input.route.floorHopIndex === null
      ? FLOOR_CODES.none
      : FLOOR_CODES.held;

  let failure: ResolutionFailure | null = null;

  if (!usable) {
    const code = breached
      ? RESOLUTION_FAILURE_CODES.floorBreached
      : RESOLUTION_FAILURE_CODES.noEligibleHop;

    failure = {
      code,
      explanation: failureExplanation(code, input.route.tag, input.route.floorHopIndex),
    };
  }

  const votes = application.votes
    .map((claim): VoteRequirement | null => {
      const provider = providerOf(claim.target.binding, health);

      // `applyRules` refuses an unbound target, so this removes nothing. It is written as a
      // filter rather than as a non-null assertion because an assertion is a claim a reader
      // has to go and verify, and this is one the compiler can carry instead.
      return provider === null
        ? null
        : {
            alias: claim.target.alias,
            modelId: claim.target.modelId,
            params: sortParams(claim.target.params),
            provider,
            ruleId: claim.ruleId,
          };
    })
    .filter((vote): vote is VoteRequirement => vote !== null);

  return {
    resolutionVersion: RESOLUTION_VERSION,
    taskKind: input.route.taskKind,
    routeTag: input.route.tag,
    outcome: usable ? "resolved" : "fail_run",
    chain,
    rules: application.outcomes,
    votes,
    floor: {
      hopIndex: input.route.floorHopIndex,
      code: floorCode,
      explanation: floorExplanation(floorCode, input.route.floorHopIndex, droppedBelowFloor),
    },
    allowLocalFallback: input.route.allowLocalFallback,
    maxCostCents: input.route.maxCostCents,
    failure,
  };
}
