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
import { evaluatePredicate } from "../../policies/org-policy.predicate";

export type { PolicyPredicate } from "../../policies/org-policy.predicate";

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
  /**
   * The published policy version that required it (BQ.2, #481) — what the gate row's provenance
   * names. Absent where the caller did not say.
   */
  readonly version?: number | null;
}

/** A rule that requires nothing. */
export const NO_HUMAN_REVIEW: HumanReviewMatch = Object.freeze({ required: false, label: null });

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

  const verdict = evaluatePredicate(rule.conditions, facts);

  if (verdict.holds !== true) {
    return NO_HUMAN_REVIEW;
  }

  return { required: true, label: verdict.labels[0] ?? null };
}
