/**
 * How the planning API refuses — every envelope answer AL.4's routes throw that AL.3's
 * `push.errors.ts` does not already name.
 *
 * AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280)). The batch-level `404`
 * (`planning_batch_not_found`) and the cycle's `422` (`dependency_cycle`) are AL.3's, reused rather
 * than restated, so a batch that does not exist and a cycle are one answer whether a draft edit or a
 * push met them first.
 *
 * **What a message may contain.** This file's own words, and the local keys and ids the request
 * itself carried — never a tracker's or a database's text.
 */

import {
  ConflictError,
  InvalidRequestError,
  NotFoundError,
  UpstreamError,
} from "../errors/error.envelope";

/** The codes this file's answers carry. */
export const PLANNING_ERRORS = Object.freeze({
  /** The batch has no draft with that local key. `404`. */
  draftNotFound: "planning_draft_not_found",
  /** The workspace has no such planning epic. `404`. */
  epicNotFound: "planning_epic_not_found",
  /** The workspace has no such ticket source. `404`. */
  sourceNotFound: "planning_source_not_found",
  /** A dependency names a local key the batch does not hold. `422`. */
  unknownDependency: "dependency_unknown_key",
  /** A draft cannot depend on itself. `422`. */
  selfDependency: "dependency_self_reference",
  /** The batch is being pushed, was pushed, or was abandoned, so its drafts cannot change. `409`. */
  batchNotEditable: "batch_not_editable",
  /** The draft has been pushed; its tracker issue is the truth now. `409`. */
  draftPushed: "draft_already_pushed",
  /** The target source's tracker cannot be written to, so no batch can be planned for it. `409`. */
  targetReadOnly: "planning_target_read_only",
  /** The engine answered with a planner name the schema cannot store. `502`. */
  plannerUnversioned: "planner_unversioned",
  /** A reorder did not name every epic of the workspace exactly once. `422`. */
  reorderIncomplete: "epic_reorder_incomplete",
  /** An epic's month range is half-given or runs backwards. `422`. */
  monthRange: "epic_month_range_invalid",
  /** A ticket to link is not in this workspace. `404`. */
  ticketsNotFound: "planning_tickets_not_found",
});

/**
 * @param batchId - The batch.
 * @param localKey - The key asked for.
 * @returns The `404` for a draft the batch does not hold.
 */
export function draftNotFound(batchId: string, localKey: string): NotFoundError {
  return new NotFoundError(
    PLANNING_ERRORS.draftNotFound,
    "This batch has no draft with that key.",
    {
      batchId,
      localKey,
    },
  );
}

/**
 * @param epicId - The epic asked for.
 * @returns The `404`.
 */
export function epicNotFound(epicId: string): NotFoundError {
  return new NotFoundError(
    PLANNING_ERRORS.epicNotFound,
    "This workspace has no such planning epic.",
    {
      epicId,
    },
  );
}

/**
 * @param sourceId - The source asked for.
 * @returns The `404` — the same answer for another workspace's source as for no source at all.
 */
export function sourceNotFound(sourceId: string): NotFoundError {
  return new NotFoundError(
    PLANNING_ERRORS.sourceNotFound,
    "This workspace has no such ticket source.",
    { sourceId },
  );
}

/**
 * @param ticketIds - The ids that matched no ticket in the workspace.
 * @returns The `404`, naming every one.
 */
export function ticketsNotFound(ticketIds: readonly string[]): NotFoundError {
  return new NotFoundError(
    PLANNING_ERRORS.ticketsNotFound,
    "Some of these tickets are not in this workspace.",
    { ticketIds: [...ticketIds] },
  );
}

/**
 * @param localKey - The draft being edited.
 * @param unknown - The keys it named that the batch does not hold.
 * @returns The `422`, naming each.
 */
export function unknownDependency(
  localKey: string,
  unknown: readonly string[],
): InvalidRequestError {
  return new InvalidRequestError(
    PLANNING_ERRORS.unknownDependency,
    `${localKey} names dependencies this batch does not hold: ${unknown.join(", ")}.`,
    { localKey, unknown: [...unknown] },
  );
}

/**
 * @param localKey - The draft that named itself.
 * @returns The `422`.
 */
export function selfDependency(localKey: string): InvalidRequestError {
  return new InvalidRequestError(
    PLANNING_ERRORS.selfDependency,
    `${localKey} cannot depend on itself.`,
    { localKey },
  );
}

/**
 * @param batchId - The batch.
 * @param status - Why not — its status.
 * @returns The `409` for a batch whose drafts cannot change.
 */
export function batchNotEditable(batchId: string, status: string): ConflictError {
  return new ConflictError(
    PLANNING_ERRORS.batchNotEditable,
    status === "pushing"
      ? "This batch is being pushed, so its drafts cannot change until the push ends."
      : status === "pushed"
        ? "Every ticket in this batch has been pushed; edit them in the tracker."
        : "This batch was abandoned, so its drafts cannot change.",
    { batchId, status },
  );
}

/**
 * @param batchId - The batch.
 * @param localKey - The pushed draft.
 * @returns The `409` for an edit to a draft whose issue already exists.
 */
export function draftPushed(batchId: string, localKey: string): ConflictError {
  return new ConflictError(
    PLANNING_ERRORS.draftPushed,
    `${localKey} has been pushed; its tracker issue is where it changes now.`,
    { batchId, localKey },
  );
}

/**
 * @param sourceId - The target source.
 * @returns The `409` for planning into a tracker that cannot be written.
 */
export function planningTargetReadOnly(sourceId: string): ConflictError {
  return new ConflictError(
    PLANNING_ERRORS.targetReadOnly,
    "This source's tracker cannot be written to, so a batch cannot be pushed to it.",
    { sourceId },
  );
}

/**
 * @param planner - What the engine said produced the batch.
 * @returns The `502` for a planner name `draft_batches_planner_versioned` would reject — the
 *   engine's fault, never the caller's.
 */
export function plannerUnversioned(planner: string): UpstreamError {
  return new UpstreamError(
    PLANNING_ERRORS.plannerUnversioned,
    "The planner answered without a name and version this service can record.",
    { planner },
  );
}

/**
 * @returns The `422` for a reorder that is not a permutation of the workspace's epics.
 */
export function reorderIncomplete(): InvalidRequestError {
  return new InvalidRequestError(
    PLANNING_ERRORS.reorderIncomplete,
    "A reorder must name every epic in this workspace exactly once.",
  );
}

/**
 * @param reason - Which rule the range broke.
 * @returns The `422` for an unusable month range.
 */
export function monthRangeInvalid(reason: "paired" | "ordered"): InvalidRequestError {
  return new InvalidRequestError(
    PLANNING_ERRORS.monthRange,
    reason === "paired"
      ? "An epic's months are both set or both empty — half a range is a bar with one end."
      : "An epic's range must not end before it starts.",
    { reason },
  );
}
