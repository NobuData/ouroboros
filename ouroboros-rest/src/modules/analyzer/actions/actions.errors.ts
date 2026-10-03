/**
 * What the Build Analyzer's suggestion actions refuse, and with which code (BV.5,
 * [#514](https://github.com/NobuData/ouroboros/issues/514)). Every refusal is raised **before** any
 * plane is asked to change anything, so a refused action writes nothing.
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../../errors/error.envelope";

/** The codes the action routes answer with. */
export const ACTION_ERRORS = {
  /** No such suggestion in this workspace. */
  suggestionNotFound: "analysis_suggestion_not_found",
  /** The suggestion is already applied, dismissed or drafted. */
  suggestionResolved: "analysis_suggestion_resolved",
  /** No plane can take this suggestion's change (or it is a ticket to draft, not apply). */
  planeUnavailable: "analysis_plane_unavailable",
  /** The suggestion is not a ticket draft or a spike, so it is applied, not drafted. */
  notDraftable: "analysis_suggestion_not_draftable",
  /** The plan changed since the preview the caller confirmed. */
  previewStale: "analysis_preview_stale",
  /** The target metric has no rolled-up baseline for the window before today. */
  baselineUnavailable: "analysis_baseline_unavailable",
  /** No analyzer-drafted batch by that id in this workspace. */
  batchNotFound: "analysis_batch_not_found",
} as const;

/**
 * @returns The `404` for a suggestion this workspace does not have.
 */
export function suggestionNotFound(): NotFoundError {
  return new NotFoundError(
    ACTION_ERRORS.suggestionNotFound,
    "No such suggestion in this workspace.",
  );
}

/**
 * @param status - What it already is.
 * @returns The `409` for a suggestion that is no longer open.
 */
export function suggestionResolved(status: string): ConflictError {
  return new ConflictError(
    ACTION_ERRORS.suggestionResolved,
    `This suggestion is already ${status}; its resolution is final.`,
    { status },
  );
}

/**
 * @param plane - The binding's plane.
 * @param reason - Why, said to the person.
 * @returns The `422` for a change no plane can take.
 */
export function planeUnavailable(plane: string, reason: string): InvalidRequestError {
  return new InvalidRequestError(
    ACTION_ERRORS.planeUnavailable,
    `This suggestion cannot be applied: ${reason}.`,
    { plane, reason },
  );
}

/**
 * @param suggestionId - The suggestion.
 * @returns The `422` for drafting what is applied instead.
 */
export function notDraftable(suggestionId: string): InvalidRequestError {
  return new InvalidRequestError(
    ACTION_ERRORS.notDraftable,
    "Only ticket suggestions and spikes are drafted; apply or dismiss this one.",
    { suggestionId },
  );
}

/**
 * @param expected - The fingerprint the caller confirmed.
 * @param current - The plan's fingerprint now.
 * @returns The `409` for an apply whose plan moved since its preview.
 */
export function previewStale(expected: string, current: string): ConflictError {
  return new ConflictError(
    ACTION_ERRORS.previewStale,
    "What this apply would do has changed since the preview — read the preview again.",
    { expected, current },
  );
}

/**
 * @param metric - The target metric.
 * @param from - The window's first day.
 * @param to - Its last day.
 * @returns The `409` for a measurement with nothing to measure against yet.
 */
export function baselineUnavailable(metric: string, from: string, to: string): ConflictError {
  return new ConflictError(
    ACTION_ERRORS.baselineUnavailable,
    `There is no ${metric} rollup for ${from}–${to}, so the prediction has no baseline to be ` +
      "measured against. The rollup fills it on its next pass; apply again then.",
    { metric, from, to },
  );
}

/**
 * @param batchId - The batch.
 * @returns The `404` for a batch the analyzer did not draft in this workspace.
 */
export function batchNotFound(batchId: string): NotFoundError {
  return new NotFoundError(
    ACTION_ERRORS.batchNotFound,
    "No batch drafted by the Build Analyzer has that id in this workspace.",
    { batchId },
  );
}
