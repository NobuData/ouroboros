/**
 * Which workflow claims a queued ticket — R.1's rules, as pure functions
 * ([#143](https://github.com/NobuData/ouroboros/issues/143)).
 *
 * `trigger.service.ts` reads the workspace's workflows and hands them here; nothing in this file
 * touches a database, so every rule below is asserted by `trigger.evaluation.spec.ts` without
 * one, and the dry-run explanation S.6 will render can call the same function rather than
 * re-deriving an answer.
 *
 * ---------------------------------------------------------------------------
 * ## When a trigger matches
 *
 * Decision **P8**'s structured predicate, `{event: "ticket_queued", conditions: {effort_lte?,
 * labels?, source?}}`, read exactly as the engine's dry-run simulator reads it
 * (`ouroboros-engine/src/ouroboros_engine/workflows/predicates.py`, `evaluate_trigger`) — one
 * language, two evaluators, one answer:
 *
 *   * Every present condition must hold (they are ANDed). An empty `conditions` matches every
 *     queued ticket, which is a thing an author may mean.
 *   * `effort_lte` compares positions in `xs < s < m < l < xl`, so `m` holds for `xs`, `s` and
 *     `m`. A ticket with no effort satisfies no effort condition.
 *   * `labels` requires the ticket to carry **all** of them, compared exactly — `Docs` is not
 *     `docs`.
 *   * `source` is equality with the tracker the ticket came from.
 *
 * ## Which workflow wins
 *
 * The resolution order, and the reason each rung records on the queue item
 * (`queue_items.workflow_pin_reason`, V032):
 *
 *   1. **An explicit choice wins** — `explicit`. The intake action bar's workflow is a person's
 *      decision, and it overrides every predicate, including one that matched something else.
 *      It is explicit among the workflows the workspace *offers*: a paused or unknown slug is
 *      refused before this file is reached (`backlog/queue.service.ts`, `422
 *      queue_workflow_unknown`), so "explicit wins" is never a way around pausing.
 *   2. **A predicate match fills the default.** Only active workflows with a published version
 *      are candidates — a paused workflow never matches, and a draft-only one has nothing a pin
 *      could name. One match is `predicate`.
 *   3. **Several matches resolve by specificity**, then by slug. Specificity is how many
 *      constraints a ticket had to satisfy: `effort_lte` counts one, `source` counts one, and each
 *      distinct required label counts one. The highest wins (`most_specific`); a tie at the top
 *      goes to the lowest slug in code-point order (`alphabetical`) — code points rather than a
 *      locale, so the answer never depends on the server's collation or on the order the
 *      candidates arrived in.
 *   4. **Nothing matched** — `suggested`. The estimate's own suggestion stands, which is what
 *      the queue did before R.1 and what keeps a workspace with no workflows queueable.
 *
 * A catch-all trigger (empty `conditions`) has specificity 0: it loses to any match that says
 * more, and it still beats the estimate's suggestion, because it *is* a match.
 *
 * ## What a pin is
 *
 * The version in force at the moment of queueing, and never a promise about later. A publish, a
 * pause or an archive after the issue was queued does not move it; T.6 re-checks status and
 * version when it claims the item. A pin whose workflow has nothing published carries a `null`
 * version rather than an invented one.
 */

import type { QueueWorkflowPinReason } from "../db/schema";
import { EffortSchema, type Effort, type SourceKind, type TriggerSpec } from "./dsl.schema";

/** Every effort, smallest first — a position in this list is a rank. */
const EFFORT_ORDER: readonly Effort[] = EffortSchema.options;

/** What a trigger is evaluated against: the canonical ticket's three facts. */
export interface TicketFacts {
  /** The tracker the ticket came from — `ticket_sources.kind`'s vocabulary. */
  readonly source: SourceKind;
  /** The labels the ticket carries, as the tracker spells them. */
  readonly labels: readonly string[];
  /** The effort of the estimate in force, or `null` for a ticket nobody has sized. */
  readonly effort: Effort | null;
}

/** A workflow that may claim a ticket: active, published, and carrying a valid trigger. */
export interface TriggerCandidate {
  /** The workflow's slug — what the queue row's `workflow_tag` will hold. */
  readonly slug: string;
  /** Its `current_version`, which is what a match pins. */
  readonly version: number;
  /** The root `trigger` of that version's definition. */
  readonly trigger: TriggerSpec;
}

/** One candidate whose trigger held for the ticket. */
export interface TriggerMatch {
  readonly slug: string;
  readonly version: number;
  /** How many constraints its trigger carried — see {@link triggerSpecificity}. */
  readonly specificity: number;
}

/** Everything {@link resolveWorkflow} decides from. */
export interface WorkflowChoice {
  /** The workflow the request named, or `undefined` when it named none. */
  readonly explicit: string | undefined;
  /** The workflow the estimate in force suggested — the answer when nothing matches. */
  readonly suggested: string;
  /** The ticket being queued. */
  readonly facts: TicketFacts;
  /** The workspace's claimable workflows. Order does not matter. */
  readonly candidates: readonly TriggerCandidate[];
  /**
   * The version in force for any slug the workspace has, whatever its status, or `null` when
   * the slug has no published version or is no workflow of this workspace at all.
   */
  readonly versionOf: (slug: string) => number | null;
}

/** Which workflow claimed a ticket, at which version, and why. */
export interface WorkflowPin {
  /** The slug to queue the ticket under. */
  readonly slug: string;
  /** The version to pin, or `null` when that workflow has nothing published. */
  readonly version: number | null;
  /** Which rung of the resolution order decided it. */
  readonly reason: QueueWorkflowPinReason;
  /**
   * Every candidate that matched, winner first, in precedence order.
   *
   * Not stored: it is a moment-in-time fact that can be recomputed. It is here for the dry-run
   * explanation and for tests that need to see *what* was resolved, not only the winner. It is
   * computed for an explicit choice too, so an explanation can say what the choice overrode.
   */
  readonly matched: readonly TriggerMatch[];
}

/**
 * Does a trigger fire for a ticket?
 *
 * @param trigger - A workflow's root `trigger`, already validated against `TriggerSchema`.
 * @param facts - The ticket being queued.
 * @returns `true` when every present condition holds — including when there are none.
 */
export function triggerMatches(trigger: TriggerSpec, facts: TicketFacts): boolean {
  const { effort_lte: effortLte, labels, source } = trigger.conditions;

  if (effortLte !== undefined) {
    if (facts.effort === null) return false;
    if (EFFORT_ORDER.indexOf(facts.effort) > EFFORT_ORDER.indexOf(effortLte)) return false;
  }

  if (labels !== undefined && !labels.every((label) => facts.labels.includes(label))) {
    return false;
  }

  if (source !== undefined && facts.source !== source) return false;

  return true;
}

/**
 * How specific a trigger is — the first tie-break when several workflows match.
 *
 * @param trigger - A workflow's root `trigger`.
 * @returns The number of constraints a ticket must satisfy: one for `effort_lte`, one for
 *   `source`, and one per **distinct** label. Distinct, because the schema does not refuse
 *   `["docs", "docs"]`, and a repeated label must not be a way to win precedence.
 */
export function triggerSpecificity(trigger: TriggerSpec): number {
  const { effort_lte: effortLte, labels, source } = trigger.conditions;

  return (
    (effortLte === undefined ? 0 : 1) + (source === undefined ? 0 : 1) + new Set(labels ?? []).size
  );
}

/**
 * Decide which workflow claims one ticket — this file's header, as a function.
 *
 * @param choice - The request's explicit workflow, the estimate's suggestion, the ticket and the
 *   workspace's candidates.
 * @returns The pin to store on the queue item, with every match that was considered.
 */
export function resolveWorkflow(choice: WorkflowChoice): WorkflowPin {
  const matched = choice.candidates
    .filter((candidate) => triggerMatches(candidate.trigger, choice.facts))
    .map((candidate) => ({
      slug: candidate.slug,
      version: candidate.version,
      specificity: triggerSpecificity(candidate.trigger),
    }))
    .sort(byPrecedence);

  if (choice.explicit !== undefined) {
    return {
      slug: choice.explicit,
      version: choice.versionOf(choice.explicit),
      reason: "explicit",
      matched,
    };
  }

  const [winner, runnerUp] = matched;

  if (winner === undefined) {
    return {
      slug: choice.suggested,
      version: choice.versionOf(choice.suggested),
      reason: "suggested",
      matched,
    };
  }

  return {
    slug: winner.slug,
    version: winner.version,
    reason: precedenceReason(winner, runnerUp),
    matched,
  };
}

/**
 * Which rung decided a predicate win.
 *
 * @param winner - The first match in precedence order.
 * @param runnerUp - The second, or `undefined` when only one matched.
 * @returns `predicate` for a lone match, `most_specific` when the winner carried strictly more
 *   constraints than anything else, and `alphabetical` when it tied and won on its slug.
 */
function precedenceReason(
  winner: TriggerMatch,
  runnerUp: TriggerMatch | undefined,
): QueueWorkflowPinReason {
  if (runnerUp === undefined) return "predicate";

  return runnerUp.specificity < winner.specificity ? "most_specific" : "alphabetical";
}

/**
 * The precedence order, as a comparator: most specific first, then the lowest slug.
 *
 * @param left - One match.
 * @param right - Another.
 * @returns Negative when `left` wins. Slugs are unique within a workspace, so two matches are
 *   never equal and the order is total.
 */
function byPrecedence(left: TriggerMatch, right: TriggerMatch): number {
  if (left.specificity !== right.specificity) return right.specificity - left.specificity;

  if (left.slug < right.slug) return -1;
  return left.slug > right.slug ? 1 : 0;
}
