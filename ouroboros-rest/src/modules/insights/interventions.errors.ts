/**
 * The intervention re-categorization's refusals (BI.3,
 * [#434](https://github.com/NobuData/ouroboros/issues/434)), each a code `openapi.yaml` publishes.
 */

import { ConflictError, NotFoundError } from "../errors/error.envelope";

/** The codes, as one object. */
export const INTERVENTION_ERRORS = {
  /** No intervention event by that id in this workspace. */
  notFound: "intervention_not_found",
  /** The event already has the cause asked for. */
  causeUnchanged: "intervention_cause_unchanged",
} as const;

/** V079's constraint names, as the service catches them (`violatesConstraint`). */
export const INTERVENTION_CONSTRAINTS = {
  /** `intervention_overrides.from_cause <> to_cause`. */
  changesCause: "intervention_overrides_changes_cause",
} as const;

/**
 * `404` — no such intervention event here (another workspace's reads the same).
 *
 * @param id - The id asked for.
 * @returns The error.
 */
export function interventionNotFound(id: string): NotFoundError {
  return new NotFoundError(
    INTERVENTION_ERRORS.notFound,
    "This workspace has no such intervention event.",
    { id },
  );
}

/**
 * `409` — the event's cause is already the one asked for, so there is nothing to correct and no
 * audit row to write.
 *
 * @param id - The event.
 * @param cause - Its cause, unchanged.
 * @returns The error.
 */
export function interventionCauseUnchanged(id: string, cause: string): ConflictError {
  return new ConflictError(
    INTERVENTION_ERRORS.causeUnchanged,
    "The intervention already has that cause.",
    { id, cause },
  );
}
