/**
 * The research estimator's refusals ([#622](https://github.com/NobuData/ouroboros/issues/622)).
 *
 * Each code is stable and is what a client branches on; the sentences are for people and may
 * improve. Every constructor here names what was asked about in `details`, so the composer can
 * point at the chip or the segment that caused it.
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";

export const RESEARCH_ERRORS = {
  /** This workspace has no investigation kind with that slug. `404`. */
  kindNotFound: "investigation_kind_not_found",
  /** A tool slug in the selection is not a registered research tool. `422`. */
  toolUnknown: "research_tool_unknown",
  /** No tools were selected and the kind's playbook turns none on. `422`. */
  toolsRequired: "research_tools_required",
  /** This workspace has no such investigation. `404`. */
  investigationNotFound: "investigation_not_found",
  /** The investigation has left `queued`, so its estimate is fixed. `409`. */
  investigationNotQueued: "investigation_not_queued",
  /** The investigation lacks an estimate or actuals, so there is nothing to compare. `409`. */
  outcomeUnavailable: "investigation_outcome_unavailable",
} as const;

/**
 * `404` — the workspace has no kind with that slug.
 *
 * @param kind - The slug asked for.
 * @returns The error.
 */
export function kindNotFound(kind: string): NotFoundError {
  return new NotFoundError(
    RESEARCH_ERRORS.kindNotFound,
    "This workspace has no investigation kind with that slug.",
    { kind },
  );
}

/**
 * `422` — one or more tool slugs are not registered research tools.
 *
 * @param tools - The unknown slugs, in selection order.
 * @returns The error.
 */
export function toolUnknown(tools: readonly string[]): InvalidRequestError {
  return new InvalidRequestError(
    RESEARCH_ERRORS.toolUnknown,
    "The tool selection names a research tool this installation does not have.",
    { tools: [...tools] },
  );
}

/**
 * `422` — the request named no tools and the kind's playbook defaults to none, so there is
 * nothing to estimate (an investigation with no tool has nothing to cite).
 *
 * @param kind - The kind whose defaults were empty.
 * @returns The error.
 */
export function toolsRequired(kind: string): InvalidRequestError {
  return new InvalidRequestError(
    RESEARCH_ERRORS.toolsRequired,
    "Select at least one research tool — this kind turns none on by default.",
    { kind },
  );
}

/**
 * `404` — the workspace has no such investigation.
 *
 * @param investigationId - The id asked for.
 * @returns The error.
 */
export function investigationNotFound(investigationId: string): NotFoundError {
  return new NotFoundError(
    RESEARCH_ERRORS.investigationNotFound,
    "This workspace has no such investigation.",
    { investigationId },
  );
}

/**
 * `409` — the investigation has started (or finished), and keeps the estimate it started under.
 *
 * @param displayId - `RS-127`.
 * @param status - Its current status.
 * @returns The error.
 */
export function investigationNotQueued(displayId: string, status: string): ConflictError {
  return new ConflictError(
    RESEARCH_ERRORS.investigationNotQueued,
    "Only a queued investigation can be estimated; this one keeps the estimate it started under.",
    { investigation: displayId, status },
  );
}

/**
 * `409` — an estimate and actuals are both needed before they can be compared.
 *
 * @param displayId - `RS-127`.
 * @returns The error.
 */
export function outcomeUnavailable(displayId: string): ConflictError {
  return new ConflictError(
    RESEARCH_ERRORS.outcomeUnavailable,
    "The investigation needs both a stored estimate and recorded actuals to be compared.",
    { investigation: displayId },
  );
}
