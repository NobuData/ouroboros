/**
 * The fact state machine, as the service enforces it (BF.2,
 * [#411](https://github.com/NobuData/ouroboros/issues/411); decision **K3**).
 *
 * **A copy of the database's machine, on purpose.** V071's `facts_legal_transition` trigger is the
 * authority — it refuses every other edge for every writer. This module is the same set, held
 * here so the service can refuse an impossible request *with a stated reason* before it reaches
 * the database, rather than translating a raised exception after the fact. The two are kept equal
 * by `facts.lifecycle.spec.ts`, which spells the V071 set out edge by edge.
 *
 *     proposed  → confirmed | rejected       "and you approve"
 *     confirmed → stale                      an anchor fired (the sweep)
 *     stale     → expired | confirmed        a person agrees, or re-confirms
 *
 * `rejected` and `expired` are terminal. Two product actions are composed from these edges rather
 * than being edges of their own:
 *
 *   * **Manual expire of a confirmed fact** is `confirmed → stale → expired` in one transaction,
 *     both steps carrying the person and the reason — V071 has no `confirmed → expired` edge, and
 *     this keeps the service's machine identical to the database's (see `FactsService.expire`).
 *   * **Re-learn** is not a transition at all: it inserts a **new** `proposed` fact whose
 *     `relearned_from_fact_id` names the expired one, so the original is never resurrected.
 */

import type { FactStatus } from "../db/schema";

/** Every legal `from → to` edge — exactly V071's `facts_guard_transition` set. */
export const FACT_TRANSITIONS: ReadonlyMap<FactStatus, readonly FactStatus[]> = new Map<
  FactStatus,
  readonly FactStatus[]
>([
  ["proposed", ["confirmed", "rejected"]],
  ["confirmed", ["stale"]],
  ["stale", ["expired", "confirmed"]],
  ["rejected", []],
  ["expired", []],
]);

/** The statuses nothing moves out of. */
export const TERMINAL_FACT_STATUSES: readonly FactStatus[] = ["rejected", "expired"];

/** The statuses that need a person behind them (V071's `facts_transition_actor`). */
export const HUMAN_GATED_STATUSES: readonly FactStatus[] = ["confirmed", "rejected", "expired"];

/**
 * Whether `from → to` is one of K3's edges.
 *
 * @param from - The fact's status now.
 * @param to - The status asked for.
 * @returns `true` for a legal edge.
 */
export function isLegalTransition(from: FactStatus, to: FactStatus): boolean {
  return FACT_TRANSITIONS.get(from)?.includes(to) ?? false;
}

/**
 * Why `from → to` is refused, in words fit to render — or `null` when it is legal.
 *
 * @param from - The fact's status now.
 * @param to - The status asked for.
 * @returns The stated reason, or `null`.
 */
export function transitionRefusal(from: FactStatus, to: FactStatus): string | null {
  if (isLegalTransition(from, to)) {
    return null;
  }
  if (from === to) {
    return `The fact is already ${from}.`;
  }
  if (from === "expired") {
    return "An expired fact is frozen. Re-learn it instead, which proposes a new fact linked to this one.";
  }
  if (from === "rejected") {
    return "A rejected fact is final. Propose it again if it has become true.";
  }
  if (to === "stale") {
    return "Only a confirmed fact can go stale.";
  }
  if (to === "expired") {
    return "Only a confirmed or stale fact can expire; a proposal that is not true is rejected instead.";
  }
  if (to === "rejected") {
    return "Only a proposal can be rejected; a confirmed fact that stopped being true is expired.";
  }
  if (to === "confirmed") {
    return from === "confirmed"
      ? "The fact is already confirmed."
      : "Only a proposal or a stale fact can be confirmed.";
  }
  return `A fact cannot move from ${from} to ${to}.`;
}

/**
 * Whether moving to a status must name the person who did it.
 *
 * @param to - The status being moved to.
 * @returns `true` for `confirmed`, `rejected` and `expired`; `stale` may be the sweep's, nobody's.
 */
export function requiresActor(to: FactStatus): boolean {
  return HUMAN_GATED_STATUSES.includes(to);
}
