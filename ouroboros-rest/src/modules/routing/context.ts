/**
 * What a caller knows about the work being routed — the `ctx` half of `resolve(taskKind, ctx)`.
 *
 * Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194)). Everything an escalation
 * rule can ask a question about lives here, and nothing else does: V018's predicate grammar
 * is closed at the database over `effort_gte`, `label` and `diff_kind`, so a context carrying
 * a fourth fact would be carrying something no rule could ever read.
 *
 * ---------------------------------------------------------------------------
 * **Every field is optional, and absence is a real answer rather than a missing one.**
 *
 * A resolution asked with no context at all is legitimate — it is what the DSL's
 * `route.task("docs")` looks like before anything has been sized or labelled — and it means
 * *no escalation rule fires*, not *every rule fires*. {@link matchesPredicate} is written so
 * that an unstated fact never satisfies a condition about it: a rule reading `effort_gte: "l"`
 * against a context with no effort has not learned that the work is small, it has learned
 * nothing, and firing on nothing would put a run on the most expensive model in the workspace
 * because a client omitted a field.
 *
 * ---------------------------------------------------------------------------
 * **`repo` is carried and nothing reads it yet, which is deliberate rather than unfinished.**
 *
 * AB.5 ([#211](https://github.com/NobuData/ouroboros/issues/211)) layers per-repository route
 * overrides over the workspace's routes, and it is the thing that will read this field. It is
 * in the shape now because the ticket's `ctx` names it and because a consumer that has the
 * repository in hand today should pass it today — the alternative is every caller of
 * `resolve` being amended on the day AB.5 lands. Nothing in this module branches on it, and
 * `resolve.spec.ts` asserts that two resolutions differing only in `repo` are identical, so
 * the field cannot quietly acquire a meaning without a test noticing.
 */

import { QUEUE_EFFORTS, type DiffKind, type EscalationWhen, type QueueEffort } from "../db/schema";

/**
 * What is known about the work a route is being resolved for.
 *
 * Named for the ticket's `ctx`, with the service's camelCase over the column's `diff_kind` —
 * the same boundary `registry/resolution.ts` draws between a row and an answer.
 */
export interface ResolutionContext {
  /**
   * How big the work was sized, on V009's five-size scale.
   *
   * Absent for work nothing has estimated, which is the ordinary state of an issue that has
   * not reached INTAKE-L.2 ([#106](https://github.com/NobuData/ouroboros/issues/106)) yet.
   */
  readonly effort?: QueueEffort;
  /**
   * The issue's labels, as GitHub spells them — the vocabulary V014 mirrors rather than one
   * of ours.
   *
   * Compared case-sensitively and whole, because GitHub's own labels are: `security` and
   * `Security` are two labels a repository may genuinely have, and folding them here would
   * make a rule fire on a label its author did not write.
   */
  readonly labels?: readonly string[];
  /** How the change was classified, when something classified it. */
  readonly diffKind?: DiffKind;
  /**
   * The repository the work belongs to.
   *
   * Read by nothing today — see this file's header, and AB.5
   * ([#211](https://github.com/NobuData/ouroboros/issues/211)).
   */
  readonly repo?: string;
}

/**
 * The five sizes as a comparable order — index is rank, `xs` is 0.
 *
 * Derived from {@link QUEUE_EFFORTS} rather than written out again, because V018's own
 * `escalation_rule_when_valid()` is checked against `queue_items_effort` by
 * `ouroboros-db/tests/constraints.sql` for exactly this reason: two tables with five sizes
 * each are one vocabulary only for as long as nobody edits one of them.
 */
const EFFORT_RANK = new Map<QueueEffort, number>(
  QUEUE_EFFORTS.map((effort, rank) => [effort, rank]),
);

/**
 * Is this effort at least that one?
 *
 * @param effort - The context's size, or `undefined` when nothing sized the work.
 * @param floor - The size the rule fires at, from `"when".effort_gte`.
 * @returns `true` when the work is that size or larger. `false` for an unsized context — see
 *   this file's header: an unstated size is not a small one.
 */
export function effortAtLeast(effort: QueueEffort | undefined, floor: QueueEffort): boolean {
  if (effort === undefined) {
    return false;
  }

  // Both are `QueueEffort`, so both are in the map; the fallbacks exist because a `Map.get`
  // is typed as possibly-undefined and a non-null assertion would be a claim a reader has to
  // verify rather than one the compiler checks.
  const rank = EFFORT_RANK.get(effort) ?? -1;
  const required = EFFORT_RANK.get(floor) ?? -1;

  return rank >= required;
}

/**
 * Does this context satisfy this predicate?
 *
 * Every key present in the predicate is **ANDed** with the others, which is WF-P8's rule and
 * V018's: `{effort_gte: "l", label: "security"}` is *both*, and a context that is large but
 * unlabelled does not match it. A predicate with no keys is refused by the column, so the
 * vacuous-truth case cannot arrive here from a stored rule — and if one ever did, it would
 * match, which is what "no conditions" means.
 *
 * @param predicate - The rule's `"when"`, already known to be in the grammar because a domain
 *   checked it at coercion.
 * @param context - What is known about the work.
 * @returns `true` when every stated condition holds.
 */
export function matchesPredicate(predicate: EscalationWhen, context: ResolutionContext): boolean {
  if (predicate.effort_gte !== undefined && !effortAtLeast(context.effort, predicate.effort_gte)) {
    return false;
  }

  if (predicate.label !== undefined && !(context.labels ?? []).includes(predicate.label)) {
    return false;
  }

  if (predicate.diff_kind !== undefined && context.diffKind !== predicate.diff_kind) {
    return false;
  }

  return true;
}
