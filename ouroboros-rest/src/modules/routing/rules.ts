/**
 * The M5 escalation semantics — what a rule *is*, and what applying one does to a chain.
 *
 * Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194)). V018 stores a rule as two
 * checked jsonb documents and derives the card's sentence from them; this file is the other
 * half of that decision — the evaluation the structure exists to make possible. Without it a
 * rule is decoration: the switch toggles, the text greys out, and routing behaves identically.
 *
 * ---------------------------------------------------------------------------
 * **Rules are applied in `sort_order`, before the chain is walked.**
 *
 * That ordering is mockup 06's promise read literally — *"escalation rules apply before the
 * chain is walked"* — and it matters in both directions. A rule that prepends a primary must
 * do so before health is consulted, or the new primary would never be health-checked; and a
 * rule that filters the chain to local providers must run before the floor is measured, or
 * the floor would be applied to a chain the rules were about to change.
 *
 * ---------------------------------------------------------------------------
 * **`use_alias` swaps or prepends, and never truncates.**
 *
 * V018 calls the action *"swap the primary model for one task kind"* and the ticket calls it
 * *"swaps or prepends the primary"*. Those are two cases of one rule, and this module treats
 * them as such:
 *
 *   * the alias is **already the primary** — the mockup's own case, where `implement`'s hop 1
 *     is `coder-max` and the rule adds `(max thinking)` — so only the params move;
 *   * the alias is **elsewhere in the chain** — it moves to the front, swapping places with
 *     what was there;
 *   * the alias is **not in the chain** — it is prepended, and everything shifts down.
 *
 * What it deliberately does **not** do is *replace* hop 1, discarding it. A rule that says
 * *use the better model for large work* is asking for a better primary, not for a shallower
 * fallback chain, and losing a hop would quietly reduce the number of providers a run can
 * survive the loss of. The moved-or-prepended alias appears exactly once either way, so an
 * executor never tries the same model twice.
 *
 * ---------------------------------------------------------------------------
 * **Params are merged rule-over-alias, and the merged object's keys are sorted.**
 *
 * Rule over alias because the rule is the more specific statement: `coder-max` says how it
 * usually runs, and *effort ≥ L* says how it runs for this work. The sort is not cosmetic —
 * the ticket requires a resolution to be identical *byte for byte* for identical inputs, and
 * JavaScript object key order survives `JSON.stringify`. `sort()` is used with no comparator,
 * which orders by UTF-16 code unit; `localeCompare` would be locale-dependent and therefore
 * the one thing a determinism requirement cannot use.
 */

import type { EscalationThen } from "../db/schema";
import type { ResolutionContext } from "./context";
import { matchesPredicate } from "./context";
import { RULE_CODES, ruleExplanation, type RuleOutcomeCode } from "./explanations";
import type { AliasSpec, PlannedHop, RuleSpec } from "./inputs";
import type { AppliedRule } from "./resolution";

/** The three route modifications a rule may carry — V018's closed set. */
export type EscalationAction = "use_alias" | "add_vote" | "route_local";

/** A second opinion a rule asked for, before its provider has been resolved. */
export interface VoteClaim {
  /** The alias that casts the vote. Always bound — an unresolvable one is not applied. */
  readonly target: AliasSpec;
  /** Which rule asked. */
  readonly ruleId: string;
}

/** What applying every matched rule left behind. */
export interface RuleApplication {
  /** The chain the walk will consider, after any swap, prepend or param merge. */
  readonly chain: readonly PlannedHop[];
  /** Every matched rule and what it did, in `sort_order`. */
  readonly outcomes: readonly AppliedRule[];
  /** The votes a `add_vote` rule attached, in the order the rules attached them. */
  readonly votes: readonly VoteClaim[];
  /** Whether a `route_local` rule fired, which the walk turns into per-hop drops. */
  readonly routeLocal: boolean;
}

/**
 * Which of the three actions a `"then"` carries.
 *
 * @param then - The rule's route modification, already known to carry exactly one action key
 *   because V018's domain counts them.
 * @returns The action.
 */
export function actionOf(then: EscalationThen): EscalationAction {
  if ("use_alias" in then) {
    return "use_alias";
  }

  return "add_vote" in then ? "add_vote" : "route_local";
}

/**
 * The task kind a rule modifies, or null for the one action that modifies everything.
 *
 * `route_local` has no task kind by design — it is the mockup's *"docs-only diff → everything
 * routes local"*, and *everything* is exactly the absence of this field.
 *
 * @param then - The rule's route modification.
 * @returns The kind's name, or null.
 */
export function targetTaskKind(then: EscalationThen): string | null {
  if ("use_alias" in then) {
    return then.use_alias.task_kind;
  }

  return "add_vote" in then ? then.add_vote.task_kind : null;
}

/**
 * The alias a rule names, or null for `route_local`, which names none.
 *
 * @param then - The rule's route modification.
 * @returns The alias's name, or null.
 */
export function targetAlias(then: EscalationThen): string | null {
  if ("use_alias" in then) {
    return then.use_alias.alias;
  }

  return "add_vote" in then ? then.add_vote.alias : null;
}

/**
 * The params a `use_alias` rule carries — the mockup's *"(max thinking)"*.
 *
 * @param then - The rule's route modification.
 * @returns The params, or `{}` for an action that carries none. Never undefined, so a caller
 *   merging them always has something to merge.
 */
export function ruleParams(then: EscalationThen): Record<string, unknown> {
  return "use_alias" in then ? (then.use_alias.params ?? {}) : {};
}

/**
 * The same object with its keys in sorted order.
 *
 * Applied to **every** hop's params rather than only to the ones a rule touched, so that two
 * resolutions of the same route serialise identically whether or not a rule fired. See this
 * file's header for why `sort()` is used bare.
 *
 * @param params - Any invocation defaults.
 * @returns A new object with the same entries, keys ascending.
 */
export function sortParams(params: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};

  for (const key of Object.keys(params).sort()) {
    sorted[key] = params[key];
  }

  return sorted;
}

/**
 * An alias's params with a rule's merged over them.
 *
 * @param base - The alias's own defaults, from `model_aliases.params`.
 * @param over - The rule's, from `"then".use_alias.params`. Wins on every shared key.
 * @returns The merged object, keys sorted.
 */
export function mergeParams(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  return sortParams({ ...base, ...over });
}

/**
 * The rules whose predicate this context satisfies, still in `sort_order`.
 *
 * Order is preserved rather than re-sorted: the caller loaded them ordered, and re-sorting
 * here would hide a repository that forgot to.
 *
 * @param rules - The workspace's enabled rules, in `sort_order`.
 * @param context - What is known about the work.
 * @returns The matching subset, in the same order.
 */
export function matchedRules(
  rules: readonly RuleSpec[],
  context: ResolutionContext,
): readonly RuleSpec[] {
  return rules.filter((rule) => matchesPredicate(rule.when, context));
}

/**
 * One rule's outcome, as the resolution reports it.
 *
 * @param rule - The rule.
 * @param code - What it did, or why it did nothing.
 * @param taskKind - The kind being resolved, for the near-miss sentence that contrasts them.
 * @returns The record.
 */
function outcome(rule: RuleSpec, code: RuleOutcomeCode, taskKind: string): AppliedRule {
  const applied =
    code === RULE_CODES.paramsMerged ||
    code === RULE_CODES.swapped ||
    code === RULE_CODES.prepended ||
    code === RULE_CODES.voteAdded ||
    code === RULE_CODES.routedLocal;

  return {
    id: rule.id,
    sortOrder: rule.sortOrder,
    display: rule.display,
    applied,
    code,
    explanation: ruleExplanation(code, targetAlias(rule.then), targetTaskKind(rule.then), taskKind),
  };
}

/**
 * Apply every matched rule to the stored chain, in order.
 *
 * Pure: it neither reads nor writes anything outside its arguments, and the chain it is given
 * is not mutated — each modification produces a new array, which is what lets a caller hold
 * the stored chain and the planned one side by side.
 *
 * @param hops - The stored chain, already planned into {@link PlannedHop}s with sorted params.
 * @param rules - The rules whose predicate matched, in `sort_order`.
 * @param aliases - Every alias in the workspace, resolved — a rule may name one the chain
 *   does not contain.
 * @param taskKind - The kind being resolved. A `use_alias` or `add_vote` naming another kind
 *   is reported as a near miss rather than silently ignored.
 * @returns The planned chain, every matched rule's outcome, the votes claimed, and whether
 *   the run was routed local.
 */
export function applyRules(
  hops: readonly PlannedHop[],
  rules: readonly RuleSpec[],
  aliases: readonly AliasSpec[],
  taskKind: string,
): RuleApplication {
  const byAlias = new Map(aliases.map((alias) => [alias.alias, alias]));

  let chain: PlannedHop[] = [...hops];
  const outcomes: AppliedRule[] = [];
  const votes: VoteClaim[] = [];
  let routeLocal = false;

  for (const rule of rules) {
    const action = actionOf(rule.then);

    if (action === "route_local") {
      routeLocal = true;
      outcomes.push(outcome(rule, RULE_CODES.routedLocal, taskKind));
      continue;
    }

    // `use_alias` and `add_vote` both name a kind, and a rule for another kind has simply not
    // fired here. Reported rather than dropped: *my rule matched and nothing happened* is the
    // question this branch exists to answer.
    if (targetTaskKind(rule.then) !== taskKind) {
      outcomes.push(outcome(rule, RULE_CODES.otherTaskKind, taskKind));
      continue;
    }

    const name = targetAlias(rule.then);
    const target = name === null ? undefined : byAlias.get(name);

    // An alias the workspace does not have, or one V019 left unbound, cannot become a primary
    // or cast a vote — there is nothing on the other end of it. V018's deferred
    // `escalation_rule_targets_exist()` keeps the first case out of the database; the second
    // is a legitimate state of a row, and this is where it stops being silent.
    if (target === undefined || target.binding === null) {
      outcomes.push(outcome(rule, RULE_CODES.aliasUnresolvable, taskKind));
      continue;
    }

    if (action === "add_vote") {
      if (votes.some((vote) => vote.target.alias === target.alias)) {
        outcomes.push(outcome(rule, RULE_CODES.voteAlreadyAdded, taskKind));
        continue;
      }

      votes.push({ target, ruleId: rule.id });
      outcomes.push(outcome(rule, RULE_CODES.voteAdded, taskKind));
      continue;
    }

    const params = mergeParams(target.params, ruleParams(rule.then));
    const at = chain.findIndex((hop) => hop.target.alias === target.alias);

    if (at === 0) {
      chain = [{ ...chain[0], params }, ...chain.slice(1)];
      outcomes.push(outcome(rule, RULE_CODES.paramsMerged, taskKind));
      continue;
    }

    if (at > 0) {
      const moved = chain[at];
      chain = [{ ...moved, params }, ...chain.filter((_, index) => index !== at)];
      outcomes.push(outcome(rule, RULE_CODES.swapped, taskKind));
      continue;
    }

    // Prepended rather than substituted — see this file's header. `position` is null because
    // this hop is not in the stored chain, which is what keeps the floor measured against the
    // numbering an operator actually saw.
    chain = [{ position: null, note: null, target, params }, ...chain];
    outcomes.push(outcome(rule, RULE_CODES.prepended, taskKind));
  }

  return { chain, outcomes, votes, routeLocal };
}
