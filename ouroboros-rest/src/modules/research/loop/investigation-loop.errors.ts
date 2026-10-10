/**
 * Why the investigation loop's control-plane half refuses (CM.1,
 * [#620](https://github.com/NobuData/ouroboros/issues/620)).
 *
 * The engine branches on these codes: a stale checkpoint or an investigation that is no longer
 * running tells a worker to stop without touching anything; a rejected brief is a bug in the
 * loop, never something a person caused.
 */

import { ConflictError, InvalidRequestError } from "../../errors/error.envelope";

/** The stable codes. */
export const INVESTIGATION_LOOP_ERRORS = {
  /** The investigation cannot be started or resumed from its status. `409`. */
  notRunnable: "investigation_not_runnable",
  /** The write comes from an attempt a newer one replaced, or repeats a checkpoint. `409`. */
  checkpointStale: "investigation_checkpoint_stale",
  /** The investigation has finished, so there is nothing left to cancel. `409`. */
  notCancellable: "investigation_not_cancellable",
  /** Routing resolves no researcher for this workspace, so nothing can synthesise. `409`. */
  researcherUnavailable: "investigation_researcher_unavailable",
  /** None of the enabled tools has an adapter in this build. `409`. */
  toolsUnavailable: "investigation_tools_unavailable",
  /** The brief is malformed: spans and claims disagree, or a text is blank. `422`. */
  briefInvalid: "brief_invalid",
  /** A finding claim cites no source. `422`. */
  claimUncited: "brief_claim_uncited",
  /** A claim or deliverable cites a source the investigation's ledger does not hold. `422`. */
  sourceUnknown: "brief_source_unknown",
  /** A deliverable input the kind's playbook does not produce. `422`. */
  deliverableUnexpected: "brief_deliverable_unexpected",
  /** A `failed` end without its reason and detail, or a `cancelled` one with them. `422`. */
  endingInvalid: "investigation_ending_invalid",
  /** The checkpoint is larger than the 2 MiB a loop may keep. `422`. */
  checkpointTooLarge: "investigation_checkpoint_too_large",
} as const;

/**
 * @param investigation - `RS-127`.
 * @param status - The status it is in.
 * @returns `409 investigation_not_runnable`.
 */
export function notRunnable(investigation: string, status: string): ConflictError {
  return new ConflictError(
    INVESTIGATION_LOOP_ERRORS.notRunnable,
    "Only a queued or running investigation can be started.",
    { investigation, status },
  );
}

/**
 * @param investigation - `RS-127`.
 * @param attempt - The attempt that wrote.
 * @returns `409 investigation_checkpoint_stale`.
 */
export function checkpointStale(investigation: string, attempt: number): ConflictError {
  return new ConflictError(
    INVESTIGATION_LOOP_ERRORS.checkpointStale,
    "A newer attempt owns this investigation, or this checkpoint was already written.",
    { investigation, attempt },
  );
}

/**
 * @param investigation - `RS-127`.
 * @param status - The status it is in.
 * @returns `409 investigation_not_cancellable`.
 */
export function notCancellable(investigation: string, status: string): ConflictError {
  return new ConflictError(
    INVESTIGATION_LOOP_ERRORS.notCancellable,
    "This investigation has already finished.",
    { investigation, status },
  );
}

/**
 * @param investigation - `RS-127`.
 * @returns `409 investigation_researcher_unavailable`.
 */
export function researcherUnavailable(investigation: string): ConflictError {
  return new ConflictError(
    INVESTIGATION_LOOP_ERRORS.researcherUnavailable,
    "Routing resolves no model for research in this workspace. Add a route for the research task kind.",
    { investigation },
  );
}

/**
 * @param investigation - `RS-127`.
 * @param tools - The tools it enabled.
 * @returns `409 investigation_tools_unavailable`.
 */
export function toolsUnavailable(investigation: string, tools: readonly string[]): ConflictError {
  return new ConflictError(
    INVESTIGATION_LOOP_ERRORS.toolsUnavailable,
    "None of this investigation's research tools is available in this installation.",
    { investigation, tools: [...tools] },
  );
}

/**
 * @param reason - What is wrong with the brief.
 * @returns `422 brief_invalid`.
 */
export function briefInvalid(reason: string): InvalidRequestError {
  return new InvalidRequestError(
    INVESTIGATION_LOOP_ERRORS.briefInvalid,
    "The brief is not well-formed.",
    { reason },
  );
}

/**
 * @param claim - The claim's span ref.
 * @returns `422 brief_claim_uncited`.
 */
export function claimUncited(claim: string): InvalidRequestError {
  return new InvalidRequestError(
    INVESTIGATION_LOOP_ERRORS.claimUncited,
    "A finding must cite at least one source. An uncited claim is an open question.",
    { claim },
  );
}

/**
 * @param where - The claim's span ref, or the deliverable.
 * @param sources - The ids the ledger does not hold.
 * @returns `422 brief_source_unknown`.
 */
export function sourceUnknown(where: string, sources: readonly string[]): InvalidRequestError {
  return new InvalidRequestError(
    INVESTIGATION_LOOP_ERRORS.sourceUnknown,
    "A citation names a source this investigation's ledger does not hold.",
    { where, sources: [...sources] },
  );
}

/**
 * @param deliverable - The key that was sent.
 * @param expected - What the playbook produces besides the brief.
 * @returns `422 brief_deliverable_unexpected`.
 */
export function deliverableUnexpected(
  deliverable: string,
  expected: readonly string[],
): InvalidRequestError {
  return new InvalidRequestError(
    INVESTIGATION_LOOP_ERRORS.deliverableUnexpected,
    "This investigation's playbook does not produce that deliverable.",
    { deliverable, expected: [...expected] },
  );
}

/**
 * @param reason - What is wrong with the ending.
 * @returns `422 investigation_ending_invalid`.
 */
export function endingInvalid(reason: string): InvalidRequestError {
  return new InvalidRequestError(
    INVESTIGATION_LOOP_ERRORS.endingInvalid,
    "A failed investigation names its reason and detail; a cancelled one names neither.",
    { reason },
  );
}

/**
 * @param bytes - The checkpoint's size.
 * @param limit - The most a loop may keep.
 * @returns `422 investigation_checkpoint_too_large`.
 */
export function checkpointTooLarge(bytes: number, limit: number): InvalidRequestError {
  return new InvalidRequestError(
    INVESTIGATION_LOOP_ERRORS.checkpointTooLarge,
    "The checkpoint is larger than an investigation may keep.",
    { bytes, limit },
  );
}
