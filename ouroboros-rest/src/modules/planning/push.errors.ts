/**
 * How a push fails — per draft, as a structured row the UI reads back, and per batch, as the
 * envelope answer a route will throw.
 *
 * AL.3 ([#279](https://github.com/NobuData/ouroboros/issues/279)): *"a failed draft records a
 * structured reason retrievable by the UI"*. The reason lands in `ticket_drafts.push_error`, whose
 * shape V034's `ticket_draft_push_error_valid` holds — `{ code, message, detail? }` — so AM.2's
 * (#284) row can branch on `code` and render `message` without parsing prose.
 *
 * **What a message may contain.** Only this file's own words and `statusReasonFor`'s — never a
 * provider's `detail`. A detail is composed from whatever a tracker answered, and tracker error
 * bodies quote request headers; a sentence built only from fixed phrases cannot carry a credential
 * however a provider was written. The same rule `ticket_sources.status_reason` keeps.
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";
import type { DraftPushError } from "../db/schema";
import {
  TICKET_SOURCE_ERROR_RETRYABLE,
  TicketSourceError,
  statusReasonFor,
} from "../ticket-sources/ticket-source.errors";
import { PUSH_DISABLED_REASONS } from "../ticket-sources/ticket-source.write";

/** The tracker call a draft's push was on when it failed. */
export type PushStep = "credentials" | "milestone" | "epic" | "create" | "link" | "attach";

/** What each step was doing, for the sentence a failed row renders. */
export const PUSH_STEP_PHRASES: Readonly<Record<PushStep, string>> = Object.freeze({
  credentials: "opening the source's credential failed",
  milestone: "ensuring the milestone failed",
  epic: "ensuring the epic's container failed",
  create: "creating the ticket failed",
  link: "linking a dependency failed",
  attach: "attaching the ticket to its epic failed",
});

/** The `push_error.code` a draft blocked by an unpushed draft carries. */
export const BLOCKER_NOT_PUSHED = "blocker_not_pushed";

/** The codes a push's envelope answers carry. */
export const PUSH_ERRORS = Object.freeze({
  /** The workspace has no such batch. `404`. */
  batchNotFound: "planning_batch_not_found",
  /** The batch is being pushed right now. `409`. */
  inProgress: "push_in_progress",
  /** The batch was abandoned, or has nothing left to push. `409`. */
  notPushable: "batch_not_pushable",
  /** The batch has no selected draft. `409`. */
  nothingSelected: "push_nothing_selected",
  /** A resume was asked of a batch no push has started. `409`. */
  nothingToResume: "push_nothing_to_resume",
  /** The target source's tracker cannot be written to. `409`. */
  readOnly: "push_target_read_only",
  /** The batch's dependencies form a cycle. `422`, naming it. */
  cycle: "dependency_cycle",
});

/** How many blocker keys a `blocker_not_pushed` message names before it says *and N more*. */
export const MAX_NAMED_BLOCKERS = 5;

/**
 * Anything a tracker call threw, as the SPI's error.
 *
 * A provider is required to throw `TicketSourceError`; one that did not has failed in a way it does
 * not describe, which is `upstream` — retryable, and never a crash of the whole push.
 *
 * @param error - What was caught.
 * @returns The error.
 */
export function asTrackerFailure(error: unknown): TicketSourceError {
  return TicketSourceError.is(error)
    ? error
    : new TicketSourceError(
        "upstream",
        "the tracker failed in a way the provider does not describe",
      );
}

/**
 * The row a draft records when a tracker call on its behalf failed.
 *
 * @param error - The classified failure.
 * @param step - Which call it was.
 * @returns `{ code: <error class>, message, detail: { step, retryable, httpStatus?, retryAt? } }`.
 */
export function draftPushError(error: TicketSourceError, step: PushStep): DraftPushError {
  return {
    code: error.errorClass,
    message: `${PUSH_STEP_PHRASES[step]} — ${statusReasonFor(error)}`,
    detail: {
      step,
      retryable: TICKET_SOURCE_ERROR_RETRYABLE[error.errorClass],
      ...(error.httpStatus === null ? {} : { httpStatus: error.httpStatus }),
      ...(error.retryAt === null ? {} : { retryAt: error.retryAt.toISOString() }),
    },
  };
}

/**
 * The row a draft records when a draft blocking it has not been pushed.
 *
 * The dependent is not created: its blocker does not exist in the tracker, so nothing could
 * reference it. A resume re-runs both.
 *
 * @param blockers - The unpushed blockers' local keys.
 * @returns `{ code: 'blocker_not_pushed', message, detail: { blockers } }`.
 */
export function blockerNotPushedError(blockers: readonly string[]): DraftPushError {
  const named = blockers.slice(0, MAX_NAMED_BLOCKERS).join(", ");
  const more = blockers.length - MAX_NAMED_BLOCKERS;

  return {
    code: BLOCKER_NOT_PUSHED,
    message:
      `waiting on ${named}${more > 0 ? ` and ${String(more)} more` : ""}, ` +
      `which ${blockers.length === 1 ? "has" : "have"} not been pushed`,
    detail: { blockers: [...blockers] },
  };
}

/**
 * @param batchId - The batch asked for.
 * @returns The `404`.
 */
export function batchNotFound(batchId: string): NotFoundError {
  return new NotFoundError(
    PUSH_ERRORS.batchNotFound,
    "This workspace has no such planning batch.",
    {
      batchId,
    },
  );
}

/**
 * @param batchId - The batch.
 * @returns The `409` for a batch already being pushed.
 */
export function pushInProgress(batchId: string): ConflictError {
  return new ConflictError(PUSH_ERRORS.inProgress, "This batch is being pushed right now.", {
    batchId,
  });
}

/**
 * @param batchId - The batch.
 * @param status - Why not — its status.
 * @returns The `409` for a batch that cannot be pushed.
 */
export function notPushable(batchId: string, status: string): ConflictError {
  return new ConflictError(
    PUSH_ERRORS.notPushable,
    status === "pushed"
      ? "Every ticket in this batch has already been pushed."
      : "This batch was abandoned and cannot be pushed.",
    { batchId, status },
  );
}

/**
 * @param batchId - The batch.
 * @returns The `409` for a batch with nothing selected to push.
 */
export function nothingSelected(batchId: string): ConflictError {
  return new ConflictError(
    PUSH_ERRORS.nothingSelected,
    "No draft in this batch is selected, so there is nothing to push.",
    { batchId },
  );
}

/**
 * @param batchId - The batch.
 * @returns The `409` for a resume of a batch nobody has pushed.
 */
export function nothingToResume(batchId: string): ConflictError {
  return new ConflictError(
    PUSH_ERRORS.nothingToResume,
    "No push of this batch has started, so there is nothing to resume.",
    { batchId },
  );
}

/**
 * @param batchId - The batch.
 * @returns The `409` for a target whose tracker cannot be written — the catalog's own sentence.
 */
export function targetReadOnly(batchId: string): ConflictError {
  return new ConflictError(PUSH_ERRORS.readOnly, PUSH_DISABLED_REASONS.readOnly, { batchId });
}

/**
 * @param batchId - The batch.
 * @param cycle - The local keys around the cycle.
 * @returns The `422` naming the cycle.
 */
export function dependencyCycle(batchId: string, cycle: readonly string[]): InvalidRequestError {
  return new InvalidRequestError(
    PUSH_ERRORS.cycle,
    `This batch's dependencies form a cycle (${cycle.join(" → ")}), so no ticket of it can go first.`,
    { batchId, cycle: [...cycle] },
  );
}
