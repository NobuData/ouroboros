/**
 * The org policy's `human_review` rule, as the gate engine applies it — *anything labeled refactor
 * needs a human*.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)), the **#358 amendment**: until
 * now the refactor-label rule lived only in mockup 16's prose. The published org policy document
 * (V092, [#480](https://github.com/NobuData/ouroboros/issues/480)) stores it as
 *
 * ```json
 * "human_review": {"enabled": true, "conditions": {"any": [{"label": "refactor"}, {"effort_gte": "l"}]}}
 * ```
 *
 * in the workflow DSL's predicate vocabulary (`schemas/org-policy/v1.json`). This evaluates that
 * predicate against a PR's ticket and says two things: whether the policy makes a human review
 * **required**, and which **label** it matched — what the inbox card's *why* names (*"Policy:
 * anything labeled refactor needs a human"*). A match by effort alone requires the review but names
 * no label, so no card claims a label policy that did not fire.
 *
 * An unknown or malformed predicate matches nothing: the document is validated where it is
 * published (BQ.2), and a reader that guessed at a shape it did not recognise could require — or
 * waive — a review nobody asked for.
 *
 * Pure.
 */

import type { QueueEffort } from "../../db/schema";

/** The five sizes, smallest first — V009's scale. */
const EFFORT_ORDER: readonly QueueEffort[] = ["xs", "s", "m", "l", "xl"];

/** One predicate of the org policy grammar: exactly one key. */
export type PolicyPredicate =
  | { readonly effort_lte: QueueEffort }
  | { readonly effort_gte: QueueEffort }
  | { readonly label: string }
  | { readonly not: PolicyPredicate }
  | { readonly any: readonly PolicyPredicate[] }
  | { readonly all: readonly PolicyPredicate[] };

/** The `human_review` rule as the document stores it. */
export interface HumanReviewRule {
  readonly enabled: boolean;
  readonly conditions: unknown;
}

/** What a PR's ticket says, for the predicate. */
export interface HumanReviewFacts {
  /** The ticket's labels. */
  readonly labels: readonly string[];
  /** Its estimated size, when one exists. */
  readonly effort: QueueEffort | undefined;
}

/** What the rule decided for one PR. */
export interface HumanReviewMatch {
  /** Whether the policy requires a human review of this PR. */
  readonly required: boolean;
  /**
   * The label the policy matched, or null when it matched on effort alone (or not at all). The
   * first positive `label` term that held, in document order.
   */
  readonly label: string | null;
}

/** A rule that requires nothing. */
export const NO_HUMAN_REVIEW: HumanReviewMatch = Object.freeze({ required: false, label: null });

/**
 * One predicate's verdict, and the positive labels that made it true.
 *
 * @param predicate - The predicate, unvalidated.
 * @param facts - The ticket's labels and effort.
 * @param negated - Whether an enclosing `not` flips it — a label under `not` never names a match.
 * @returns Whether it holds (undefined for a shape this reader does not know) and the labels that
 *   held positively.
 */
function evaluate(
  predicate: unknown,
  facts: HumanReviewFacts,
  negated: boolean,
): { holds: boolean | undefined; labels: string[] } {
  if (typeof predicate !== "object" || predicate === null || Array.isArray(predicate)) {
    return { holds: undefined, labels: [] };
  }

  const entries: [string, unknown][] = Object.entries(predicate as Record<string, unknown>);

  if (entries.length !== 1) {
    return { holds: undefined, labels: [] };
  }

  const [key, value] = entries[0];

  switch (key) {
    case "label": {
      if (typeof value !== "string") {
        return { holds: undefined, labels: [] };
      }

      const holds = facts.labels.includes(value);

      return { holds, labels: holds && !negated ? [value] : [] };
    }
    case "effort_gte":
    case "effort_lte": {
      const floor = EFFORT_ORDER.indexOf(value as QueueEffort);

      if (floor < 0) {
        return { holds: undefined, labels: [] };
      }

      if (facts.effort === undefined) {
        // An unestimated ticket satisfies no size comparison — the routing rules' posture.
        return { holds: false, labels: [] };
      }

      const size = EFFORT_ORDER.indexOf(facts.effort);

      return { holds: key === "effort_gte" ? size >= floor : size <= floor, labels: [] };
    }
    case "not": {
      const inner = evaluate(value, facts, !negated);

      return { holds: inner.holds === undefined ? undefined : !inner.holds, labels: [] };
    }
    case "any":
    case "all": {
      if (!Array.isArray(value) || value.length === 0) {
        return { holds: undefined, labels: [] };
      }

      const parts = value.map((part) => evaluate(part, facts, negated));

      if (parts.some((part) => part.holds === undefined)) {
        return { holds: undefined, labels: [] };
      }

      const holds =
        key === "any"
          ? parts.some((part) => part.holds === true)
          : parts.every((part) => part.holds);

      return {
        holds,
        labels: holds ? parts.filter((part) => part.holds).flatMap((part) => part.labels) : [],
      };
    }
    default:
      return { holds: undefined, labels: [] };
  }
}

/**
 * Apply the `human_review` rule to one PR's ticket.
 *
 * @param rule - The rule from the published policy, or null when the workspace has none.
 * @param facts - The ticket's labels and effort.
 * @returns Whether a review is required and which label the policy matched.
 */
export function matchHumanReview(
  rule: HumanReviewRule | null | undefined,
  facts: HumanReviewFacts,
): HumanReviewMatch {
  if (rule === null || rule === undefined || !rule.enabled) {
    return NO_HUMAN_REVIEW;
  }

  const verdict = evaluate(rule.conditions, facts, false);

  if (verdict.holds !== true) {
    return NO_HUMAN_REVIEW;
  }

  return { required: true, label: verdict.labels[0] ?? null };
}
