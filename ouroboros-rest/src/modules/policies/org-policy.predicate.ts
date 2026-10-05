/**
 * The org policy's predicate grammar, evaluated — pure.
 *
 * `auto_merge` and `human_review` hold their conditions in the workflow DSL's predicate vocabulary
 * (#133, decision P8; `schemas/org-policy/v1.json` `$defs.predicate`): a comparison (`effort_lte`,
 * `effort_gte`, `label`) or a composition (`not`, `any`, `all`), exactly one key each, recursive:
 *
 * ```json
 * {"all": [{"effort_lte": "m"}, {"not": {"label": "refactor"}}]}     effort ≤ M · non-refactor
 * ```
 *
 * One evaluator for every rule that holds a predicate, so `auto_merge` and `human_review` cannot
 * disagree about what `effort_gte: "l"` means. Its comparison semantics are the routing rules' and
 * the trigger evaluator's (`workflows/trigger.evaluation.ts`): efforts rank `xs < s < m < l < xl`,
 * and an **unestimated ticket satisfies no size comparison**.
 *
 * **An unknown or malformed predicate holds neither way** (`holds: undefined`). The document is
 * validated where it is published (`policy-publish.service.ts`), and a reader that guessed at a
 * shape it did not recognise could require — or waive — something nobody asked for. Each caller
 * decides what "cannot tell" means for its rule, always the stricter way.
 *
 * Moved here from the gate engine's `gate.human-review.ts` by BQ.2
 * ([#481](https://github.com/NobuData/ouroboros/issues/481)), so the policy plane owns it.
 */

import type { QueueEffort } from "../db/schema";

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

/** What a predicate is evaluated against: the PR's ticket. */
export interface PredicateFacts {
  /** The ticket's labels. */
  readonly labels: readonly string[];
  /** Its estimated size, when one exists. */
  readonly effort: QueueEffort | undefined;
}

/** A predicate's verdict. */
export interface PredicateVerdict {
  /** Whether it holds — undefined for a shape this reader does not know. */
  readonly holds: boolean | undefined;
  /**
   * The labels that made it true, positively — never one under a `not` — in document order. What
   * the inbox card's *why* names (*"anything labeled refactor"*).
   */
  readonly labels: readonly string[];
}

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
  facts: PredicateFacts,
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
 * Evaluate a rule's conditions against a PR's ticket.
 *
 * @param predicate - The conditions, unvalidated.
 * @param facts - The ticket's labels and effort.
 * @returns Whether they hold, and the labels that made them hold.
 */
export function evaluatePredicate(predicate: unknown, facts: PredicateFacts): PredicateVerdict {
  return evaluate(predicate, facts, false);
}
