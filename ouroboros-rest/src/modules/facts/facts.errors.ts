/**
 * Every refusal the fact service makes, as the envelope carries it (BF.2,
 * [#411](https://github.com/NobuData/ouroboros/issues/411)).
 *
 *   * **An impossible transition** — `409 fact_transition_refused`, with `details.from`,
 *     `details.to` and `details.reason`: the stated reason `transitionRefusal` gives, so a client
 *     can render why *Confirm* did nothing without owning a copy of the machine.
 *   * **A frozen fact** — `409 fact_frozen` for an anchor change on a rejected or expired fact:
 *     what the struck-through row renders never changes afterwards (V071's `facts_expired_frozen`).
 *   * **A provenance reference to another workspace's row** — `422 fact_provenance_unresolved`,
 *     V071's `facts_provenance_resolves`.
 *
 * The service checks the machine before writing; the database constraints named in
 * {@link FACT_CONSTRAINTS} are the backstop a race falls into, and each maps to the same answer.
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";
import type { FactStatus } from "../db/schema";

/** Every code this module answers with. */
export const FACT_ERRORS = {
  factNotFound: "fact_not_found",
  anchorNotFound: "fact_anchor_not_found",
  anchorExists: "fact_anchor_exists",
  anchorInvalid: "fact_anchor_invalid",
  transitionRefused: "fact_transition_refused",
  frozen: "fact_frozen",
  changed: "fact_changed",
  provenanceUnresolved: "fact_provenance_unresolved",
} as const;

/** The V071 constraints this service turns into answers, by name. */
export const FACT_CONSTRAINTS = {
  legalTransition: "facts_legal_transition",
  transitionActor: "facts_transition_actor",
  relearnFromExpired: "facts_relearn_from_expired",
  provenanceResolves: "facts_provenance_resolves",
  anchorUnique: "fact_anchors_fact_kind_value_key",
} as const;

/**
 * @param factId - The id asked for.
 * @returns `404 fact_not_found` — absent, or another workspace's, indistinguishably.
 */
export function factNotFound(factId: string): NotFoundError {
  return new NotFoundError(FACT_ERRORS.factNotFound, "No such fact.", { factId });
}

/**
 * @param factId - The fact.
 * @param anchorId - The anchor asked for.
 * @returns `404 fact_anchor_not_found`.
 */
export function anchorNotFound(factId: string, anchorId: string): NotFoundError {
  return new NotFoundError(FACT_ERRORS.anchorNotFound, "No such anchor on this fact.", {
    factId,
    anchorId,
  });
}

/**
 * @param factId - The fact.
 * @param kind - The anchor's kind.
 * @param value - The anchor's value.
 * @returns `409 fact_anchor_exists`.
 */
export function anchorExists(factId: string, kind: string, value: string): ConflictError {
  return new ConflictError(FACT_ERRORS.anchorExists, "This fact already has that anchor.", {
    factId,
    kind,
    value,
  });
}

/**
 * @param kind - The anchor's kind.
 * @param value - The value refused.
 * @param problem - Why, from `anchorValueProblem`.
 * @returns `422 fact_anchor_invalid`.
 */
export function anchorInvalid(kind: string, value: string, problem: string): InvalidRequestError {
  return new InvalidRequestError(FACT_ERRORS.anchorInvalid, problem, { kind, value });
}

/**
 * @param factId - The fact.
 * @param from - Its status now.
 * @param to - The status asked for.
 * @param reason - Why the machine refuses the edge.
 * @returns `409 fact_transition_refused`.
 */
export function transitionRefused(
  factId: string,
  from: FactStatus,
  to: FactStatus,
  reason: string,
): ConflictError {
  return new ConflictError(FACT_ERRORS.transitionRefused, reason, { factId, from, to, reason });
}

/**
 * @param factId - The fact.
 * @param status - Its terminal status.
 * @returns `409 fact_frozen`.
 */
export function factFrozen(factId: string, status: FactStatus): ConflictError {
  return new ConflictError(
    FACT_ERRORS.frozen,
    `A ${status} fact is frozen; its anchors cannot change.`,
    { factId, status },
  );
}

/** @returns `422 fact_provenance_unresolved`. */
export function provenanceUnresolved(): InvalidRequestError {
  return new InvalidRequestError(
    FACT_ERRORS.provenanceUnresolved,
    "The provenance names a run, pull request or ticket that is not this workspace's.",
  );
}

/**
 * @param factId - The fact.
 * @returns `409 fact_changed` — the fact moved under a concurrent writer; reload and retry.
 */
export function factChanged(factId: string): ConflictError {
  return new ConflictError(
    FACT_ERRORS.changed,
    "The fact changed while this request was in flight. Reload it and try again.",
    { factId },
  );
}
