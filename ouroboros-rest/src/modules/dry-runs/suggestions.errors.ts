/**
 * What the suggestion routes can refuse with (CD.5,
 * [#563](https://github.com/NobuData/ouroboros/issues/563)).
 */

import { ConflictError, NotFoundError } from "../errors/error.envelope";

/** Every code these routes answer with. The document (`openapi.yaml`) is the registry. */
export const DRY_RUN_SUGGESTION_ERRORS = {
  /** No such suggestion of that dry run. */
  notFound: "dry_run_suggestion_not_found",
  /** The suggestion was already applied or ignored. */
  resolved: "dry_run_suggestion_resolved",
  /** The suggestion is advisory: it carries no operations. */
  notApplicable: "dry_run_suggestion_not_applicable",
  /** The draft moved on, and the suggestion's operations no longer fit it. */
  conflict: "dry_run_suggestion_conflict",
} as const;

/**
 * `404` — no such suggestion.
 *
 * @param suggestionId - The id the request named.
 * @returns The error to throw.
 */
export function suggestionNotFound(suggestionId: string): NotFoundError {
  return new NotFoundError(
    DRY_RUN_SUGGESTION_ERRORS.notFound,
    "This dry run has no such suggestion.",
    { suggestionId },
  );
}

/**
 * `409` — the suggestion is settled; a resolution is final.
 *
 * @param suggestionId - The suggestion.
 * @param status - `applied` or `ignored`.
 * @returns The error to throw.
 */
export function suggestionResolved(suggestionId: string, status: string): ConflictError {
  return new ConflictError(
    DRY_RUN_SUGGESTION_ERRORS.resolved,
    `This suggestion was already ${status}.`,
    { suggestionId, status },
  );
}

/**
 * `409` — an advisory suggestion has nothing to apply.
 *
 * @param suggestionId - The suggestion.
 * @returns The error to throw.
 */
export function suggestionNotApplicable(suggestionId: string): ConflictError {
  return new ConflictError(
    DRY_RUN_SUGGESTION_ERRORS.notApplicable,
    "This suggestion is advisory: it proposes no change to the draft, so there is nothing to apply.",
    { suggestionId },
  );
}

/**
 * `409` — the draft moved on and an operation no longer fits. Nothing was written.
 *
 * @param suggestionId - The suggestion.
 * @param conflict - Which operation did not fit, why, and the two revisions.
 * @returns The error to throw.
 */
export function suggestionConflict(
  suggestionId: string,
  conflict: {
    readonly operation: number;
    readonly kind: string;
    readonly reason: string;
    readonly testedDraftRev: number;
    readonly draftRev: number;
  },
): ConflictError {
  return new ConflictError(
    DRY_RUN_SUGGESTION_ERRORS.conflict,
    `The draft has changed since this suggestion was made, and it no longer fits: ${conflict.reason} Run the dry run again to get suggestions for the draft as it is now.`,
    { suggestionId, ...conflict },
  );
}
