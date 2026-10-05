/**
 * What a policy edit changes, and which way — pure (BQ.2,
 * [#481](https://github.com/NobuData/ouroboros/issues/481)).
 *
 * Publishing is a privileged, classified operation. Some edits **tighten** autonomy (more
 * reviews, fewer unattended merges) and some **loosen** it (the reverse), and those are not the
 * same risk: an admin may publish a tightening or a neutral change, a loosening needs the owner.
 * The settings card's confirm dialog (BS.4, #494) shows each rule's class, so the class comes from
 * here, per rule, rather than being guessed by a UI.
 *
 * **The classes are computed, not guessed.** Each rule is read as *the set of things it lets
 * through unattended*, and an edit is compared set against set:
 *
 * ```
 * rule               the set                                       loosening when the new set…
 * auto_merge         tickets eligible to merge unattended          holds a ticket the old one did not
 * human_review       tickets a person must review                  misses a ticket the old one held
 * protected_paths    globs a change needs an allow-once for        misses a glob the old one held
 * spend_guard        each cap (∞ when unset or off)                has a cap higher than before
 * dry_run_new_repos  N, the loops a new repository spends in dry-run   is smaller than before
 * custom:*           — (nothing enforces it yet)                   changes at all
 * ```
 *
 * For the two predicate rules the comparison is **exact**: a predicate reads only the ticket's
 * effort and the labels it names, so every ticket that could tell the old conditions from the new
 * is one of `6 efforts × 2^labels` cases, and all of them are evaluated (with at most
 * {@link MAX_EXACT_LABELS} distinct labels; beyond that any change is classed as loosening).
 * An edit that both adds and removes is a loosening — something now gets through that did not.
 *
 * A rule nothing enforces in this release (`custom:*`) cannot be judged, so any change to one is
 * classed the stricter way. With nothing published before, the baseline is *no policy*: everything
 * may auto-merge, nothing needs a review, nothing is protected, nothing is capped.
 */

import type { QueueEffort } from "../db/schema";
import { CORE_RULE_IDS, type OrgPolicyRule } from "./org-policy.document";
import { evaluatePredicate, type PredicateFacts } from "./org-policy.predicate";

/** Which way one change moves autonomy. */
export type ChangeClass = "tightening" | "loosening" | "neutral";

/** One rule an edit changes. */
export interface RuleChange {
  /** `auto_merge`, `custom:freeze-friday`, … */
  readonly ruleId: string;
  /** Which way it moves autonomy. */
  readonly classification: ChangeClass;
  /** What the audit line and the dialog say — `enabled auto-merge`. */
  readonly summary: string;
}

/** Everything an edit changes. */
export interface PolicyDiff {
  /** The changed rules, in the card's order then the custom rules by id. */
  readonly changes: readonly RuleChange[];
  /** The edit's class: loosening if any change loosens, else tightening if any tightens. */
  readonly classification: ChangeClass;
}

/** The most distinct labels the exact predicate comparison enumerates. */
export const MAX_EXACT_LABELS = 10;

/** Every effort, and the unestimated ticket. */
const EFFORTS: readonly (QueueEffort | undefined)[] = [undefined, "xs", "s", "m", "l", "xl"];

/** How each core rule is named in a sentence. */
const RULE_NAMES: Readonly<Record<string, string>> = {
  auto_merge: "auto-merge",
  human_review: "human review",
  protected_paths: "protected paths",
  spend_guard: "the spend guard",
  dry_run_new_repos: "dry-run for new repos",
};

/**
 * A rule as a sentence names it.
 *
 * @param ruleId - The rule.
 * @returns `auto-merge`, or the id itself for a custom rule.
 */
export function ruleName(ruleId: string): string {
  return RULE_NAMES[ruleId] ?? ruleId;
}

/**
 * A value as canonical JSON — object keys sorted — so two documents that differ only in key order
 * are the same document.
 *
 * @param value - The value.
 * @returns Its canonical text.
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

/**
 * Every label a predicate names, anywhere in it.
 *
 * @param predicate - The predicate.
 * @param into - Where to collect them.
 */
function labelsIn(predicate: unknown, into: Set<string>): void {
  if (Array.isArray(predicate)) {
    predicate.forEach((part) => labelsIn(part, into));
  } else if (typeof predicate === "object" && predicate !== null) {
    for (const [key, value] of Object.entries(predicate as Record<string, unknown>)) {
      if (key === "label" && typeof value === "string") {
        into.add(value);
      } else {
        labelsIn(value, into);
      }
    }
  }
}

/**
 * Every ticket that could tell two predicates apart: each effort (and none) with each subset of
 * the labels either names.
 *
 * @param labels - The labels.
 * @returns The tickets.
 */
function ticketsOver(labels: readonly string[]): PredicateFacts[] {
  const tickets: PredicateFacts[] = [];

  for (let mask = 0; mask < 2 ** labels.length; mask += 1) {
    const held = labels.filter((_, index) => (mask & (1 << index)) !== 0);

    for (const effort of EFFORTS) {
      tickets.push({ labels: held, effort });
    }
  }

  return tickets;
}

/**
 * Compare two sets by membership over a finite universe.
 *
 * @param before - Membership before.
 * @param after - Membership after.
 * @param universe - Every case.
 * @returns Whether `after` holds a case `before` did not, and the reverse.
 */
function compareSets<T>(
  before: (item: T) => boolean,
  after: (item: T) => boolean,
  universe: readonly T[],
): { gained: boolean; lost: boolean } {
  let gained = false;
  let lost = false;

  for (const item of universe) {
    const was = before(item);
    const is = after(item);

    gained ||= is && !was;
    lost ||= was && !is;
  }

  return { gained, lost };
}

/**
 * The class of a change that **widens** autonomy when its set gains members.
 *
 * @param change - What the set gained and lost.
 * @param gainLoosens - Whether gaining a member loosens (auto-merge) or tightens (review).
 * @returns The class.
 */
function classOf(change: { gained: boolean; lost: boolean }, gainLoosens: boolean): ChangeClass {
  const loosens = gainLoosens ? change.gained : change.lost;
  const tightens = gainLoosens ? change.lost : change.gained;

  return loosens ? "loosening" : tightens ? "tightening" : "neutral";
}

/**
 * A predicate rule's set, as a membership test — `fallback` is the set when nothing is published.
 *
 * @param rule - The rule, or undefined when the side has no policy.
 * @param fallback - Membership with no policy.
 * @returns The test.
 */
function predicateSet(
  rule: OrgPolicyRule | undefined,
  fallback: boolean,
): (ticket: PredicateFacts) => boolean {
  if (rule === undefined) {
    return () => fallback;
  }

  return (ticket) => rule.enabled && evaluatePredicate(rule.conditions, ticket).holds === true;
}

/**
 * Classify a predicate rule's change exactly.
 *
 * @param before - The rule before, or undefined.
 * @param after - The rule after, or undefined.
 * @param noPolicy - Membership with no policy (`auto_merge`: every ticket; `human_review`: none).
 * @param gainLoosens - Whether a ticket joining the set loosens.
 * @returns The class.
 */
function classifyPredicateRule(
  before: OrgPolicyRule | undefined,
  after: OrgPolicyRule | undefined,
  noPolicy: boolean,
  gainLoosens: boolean,
): ChangeClass {
  const labels = new Set<string>();

  labelsIn(before?.conditions, labels);
  labelsIn(after?.conditions, labels);

  if (labels.size > MAX_EXACT_LABELS) {
    return "loosening";
  }

  return classOf(
    compareSets(
      predicateSet(before, noPolicy),
      predicateSet(after, noPolicy),
      ticketsOver([...labels]),
    ),
    gainLoosens,
  );
}

/**
 * The globs a `protected_paths` rule protects — none while it is off.
 *
 * @param rule - The rule, or undefined.
 * @returns The globs.
 */
function globsOf(rule: OrgPolicyRule | undefined): Set<string> {
  const listed = rule?.enabled === true ? rule.conditions.path_globs : undefined;

  return new Set(
    Array.isArray(listed) ? listed.filter((glob): glob is string => typeof glob === "string") : [],
  );
}

/**
 * A cap as a number to compare — unset, off or absent is unlimited.
 *
 * @param rule - `spend_guard`, or undefined.
 * @param key - Which cap.
 * @returns The cents, or `Infinity`.
 */
function capOf(rule: OrgPolicyRule | undefined, key: string): number {
  const value = rule?.enabled === true ? rule.conditions[key] : undefined;

  return typeof value === "number" ? value : Number.POSITIVE_INFINITY;
}

/**
 * The loops a new repository spends in dry-run — none while the rule is off.
 *
 * @param rule - `dry_run_new_repos`, or undefined.
 * @returns N.
 */
function loopsOf(rule: OrgPolicyRule | undefined): number {
  const value = rule?.enabled === true ? rule.conditions.first_n_loops : undefined;

  return typeof value === "number" ? value : 0;
}

/**
 * Classify one rule's change.
 *
 * @param ruleId - The rule.
 * @param before - It before, or undefined when the previous version lacked it (or none existed).
 * @param after - It after, or undefined when the new version drops it.
 * @returns The class.
 */
export function classifyRule(
  ruleId: string,
  before: OrgPolicyRule | undefined,
  after: OrgPolicyRule | undefined,
): ChangeClass {
  switch (ruleId) {
    case "auto_merge":
      return classifyPredicateRule(before, after, true, true);
    case "human_review":
      return classifyPredicateRule(before, after, false, false);
    case "protected_paths": {
      const old = globsOf(before);
      const next = globsOf(after);

      return classOf(
        {
          gained: [...next].some((glob) => !old.has(glob)),
          lost: [...old].some((glob) => !next.has(glob)),
        },
        false,
      );
    }
    case "spend_guard": {
      const moves = ["per_run_cap_cents", "monthly_cap_cents"].map(
        (key) => capOf(after, key) - capOf(before, key),
      );

      // ∞ − ∞ is NaN: an unlimited cap that stays unlimited moved nowhere.
      return moves.some((move) => move > 0)
        ? "loosening"
        : moves.some((move) => move < 0)
          ? "tightening"
          : "neutral";
    }
    case "dry_run_new_repos": {
      const move = loopsOf(after) - loopsOf(before);

      return move < 0 ? "loosening" : move > 0 ? "tightening" : "neutral";
    }
    default:
      // Nothing in this release enforces a custom rule, so nothing can say which way it moves.
      return "loosening";
  }
}

/**
 * How the change reads in a sentence — `enabled auto-merge`.
 *
 * @param ruleId - The rule.
 * @param before - It before, or undefined.
 * @param after - It after, or undefined.
 * @returns The phrase.
 */
function summaryOf(
  ruleId: string,
  before: OrgPolicyRule | undefined,
  after: OrgPolicyRule | undefined,
): string {
  const name = ruleName(ruleId);

  if (after === undefined) {
    return `removed ${name}`;
  }

  if (before?.enabled !== after.enabled) {
    return after.enabled ? `enabled ${name}` : `disabled ${name}`;
  }

  return `changed ${name}`;
}

/**
 * Order rule ids as the card does: the five core rules first, then the custom ones by id.
 *
 * @param left - One id.
 * @param right - Another.
 * @returns The comparison.
 */
function cardOrder(left: string, right: string): number {
  const rank = (id: string): number => {
    const core = (CORE_RULE_IDS as readonly string[]).indexOf(id);

    return core < 0 ? CORE_RULE_IDS.length : core;
  };

  return rank(left) - rank(right) || (left < right ? -1 : left > right ? 1 : 0);
}

/**
 * Everything an edit changes, per rule, and the edit's class.
 *
 * @param before - The rules in force, or null when nothing is published yet.
 * @param after - The rules to publish.
 * @returns The diff — no changes for an edit that changes nothing.
 */
export function diffPolicies(
  before: Readonly<Record<string, OrgPolicyRule>> | null,
  after: Readonly<Record<string, OrgPolicyRule>>,
): PolicyDiff {
  const old = before ?? {};
  const ids = [...new Set([...Object.keys(old), ...Object.keys(after)])].sort(cardOrder);
  const changes: RuleChange[] = [];

  for (const ruleId of ids) {
    const was = old[ruleId] as OrgPolicyRule | undefined;
    const is = after[ruleId] as OrgPolicyRule | undefined;

    if (canonical(was) === canonical(is)) {
      continue;
    }

    changes.push({
      ruleId,
      classification: classifyRule(ruleId, was, is),
      summary: summaryOf(ruleId, was, is),
    });
  }

  return {
    changes,
    classification: changes.some((change) => change.classification === "loosening")
      ? "loosening"
      : changes.some((change) => change.classification === "tightening")
        ? "tightening"
        : "neutral",
  };
}

/**
 * The audit line's text — the mockup's `enabled auto-merge (policy v7)`, which the audit card
 * prefixes with the person (*"Ken enabled auto-merge (policy v7)"*).
 *
 * @param diff - What the publish changed.
 * @param version - The version it published.
 * @returns The line.
 */
export function publishSummary(diff: PolicyDiff, version: number): string {
  const what =
    diff.changes.length === 0
      ? "republished the policy"
      : diff.changes.map((change) => change.summary).join(", ");

  return `${what} (policy v${String(version)})`;
}
