/**
 * The action executor's refusals — each a `DomainError` with a stable code (BN.2,
 * [#462](https://github.com/NobuData/ouroboros/issues/462)).
 *
 * The codes a card's UI branches on: `decision_already_answered` carries the winning resolution so
 * the card can say *"answered by Priya 10 s ago"*, `decision_action_in_progress` the attempt that is
 * still running, and `decision_action_unbound` names an action whose owning plane has no operation
 * yet. Errors a plane raises while executing (a merge plan that is not armable, a forbidden control)
 * pass through unchanged — the plane is the authority on why it refused.
 */

import {
  ConflictError,
  ForbiddenError,
  InvalidRequestError,
  NotFoundError,
  NotImplementedError,
  type ErrorDetails,
} from "../errors/error.envelope";

/** Every code this module answers with. */
export const INBOX_ACTION_ERRORS = {
  itemNotFound: "decision_item_not_found",
  actionNotFound: "decision_action_not_found",
  notAnAnswer: "decision_action_not_an_answer",
  forbidden: "decision_action_forbidden",
  needsPerson: "decision_action_needs_person",
  noteRequired: "decision_note_required",
  noteNotTaken: "decision_note_not_taken",
  alreadyAnswered: "decision_already_answered",
  itemExpired: "decision_item_expired",
  inProgress: "decision_action_in_progress",
  keyReused: "decision_idempotency_key_reused",
  unbound: "decision_action_unbound",
  refMissing: "decision_item_ref_missing",
  stillBlocked: "allow_once_still_blocked",
  benchTargetMissing: "bench_upgrade_target_missing",
  mergeRefused: "merge_refused",
} as const;

/**
 * No item with this id in the workspace.
 *
 * @param itemId - The id asked for.
 * @returns The error.
 */
export function decisionItemNotFound(itemId: string): NotFoundError {
  return new NotFoundError(
    INBOX_ACTION_ERRORS.itemNotFound,
    `No decision item ${itemId} exists in this workspace.`,
    { itemId },
  );
}

/**
 * The item's pinned kind declares no such action.
 *
 * @param kindId - The item's kind.
 * @param actionId - The action asked for.
 * @returns The error.
 */
export function decisionActionNotFound(kindId: string, actionId: string): NotFoundError {
  return new NotFoundError(
    INBOX_ACTION_ERRORS.actionNotFound,
    `A ${kindId} card has no action ${actionId}.`,
    { kindId, actionId },
  );
}

/**
 * The action is a link (`navigate.*`) or otherwise not one that answers the item.
 *
 * @param actionId - The action.
 * @returns The error.
 */
export function decisionActionNotAnAnswer(actionId: string): InvalidRequestError {
  return new InvalidRequestError(
    INBOX_ACTION_ERRORS.notAnAnswer,
    `Action ${actionId} opens a page; it does not answer the decision.`,
    { actionId },
  );
}

/**
 * The person lacks the role (or capability) the action declares.
 *
 * @param actionId - The action.
 * @param required - Its `required_role`.
 * @returns The error.
 */
export function decisionActionForbidden(actionId: string, required: string): ForbiddenError {
  return new ForbiddenError(
    INBOX_ACTION_ERRORS.forbidden,
    `Action ${actionId} needs the ${required} role.`,
    { actionId, required },
  );
}

/**
 * Only a signed-in person answers a decision — a service account has no one to name.
 *
 * @returns The error.
 */
export function decisionActionNeedsPerson(): ForbiddenError {
  return new ForbiddenError(
    INBOX_ACTION_ERRORS.needsPerson,
    "A decision is answered by a signed-in person; a service account cannot answer one.",
  );
}

/**
 * The action takes a note and none was given.
 *
 * @param actionId - The action.
 * @returns The error.
 */
export function decisionNoteRequired(actionId: string): InvalidRequestError {
  return new InvalidRequestError(
    INBOX_ACTION_ERRORS.noteRequired,
    `Action ${actionId} needs a note.`,
    { actionId },
  );
}

/**
 * A note was given to an action that takes none.
 *
 * @param actionId - The action.
 * @returns The error.
 */
export function decisionNoteNotTaken(actionId: string): InvalidRequestError {
  return new InvalidRequestError(
    INBOX_ACTION_ERRORS.noteNotTaken,
    `Action ${actionId} takes no note.`,
    { actionId },
  );
}

/** The resolution that won, as a loser is told it. */
export interface WinningResolution {
  readonly actionId: string;
  readonly resolver: "human" | "policy";
  readonly policy: string | null;
  readonly actor: { readonly id: string; readonly name: string } | null;
  readonly channel: string;
  readonly resolvedAt: string;
}

/**
 * Someone (or something) answered first.
 *
 * @param itemId - The item.
 * @param resolution - Who answered, how and when.
 * @returns The error.
 */
export function decisionAlreadyAnswered(
  itemId: string,
  resolution: WinningResolution,
): ConflictError {
  const who = resolution.actor?.name ?? (resolution.policy === null ? "someone" : "a policy");

  return new ConflictError(
    INBOX_ACTION_ERRORS.alreadyAnswered,
    `This decision was already answered by ${who}.`,
    { itemId, resolution: { ...resolution } },
  );
}

/**
 * The item's window lapsed unanswered.
 *
 * @param itemId - The item.
 * @returns The error.
 */
export function decisionItemExpired(itemId: string): ConflictError {
  return new ConflictError(
    INBOX_ACTION_ERRORS.itemExpired,
    "This decision expired before it was answered.",
    { itemId },
  );
}

/**
 * Another answer is running right now.
 *
 * @param itemId - The item.
 * @param attempt - The running attempt.
 * @param attempt.actionId - Its action.
 * @param attempt.actor - Who pressed it.
 * @param attempt.startedAt - When.
 * @returns The error.
 */
export function decisionActionInProgress(
  itemId: string,
  attempt: {
    readonly actionId: string;
    readonly actor: { readonly id: string; readonly name: string } | null;
    readonly startedAt: string;
  },
): ConflictError {
  return new ConflictError(
    INBOX_ACTION_ERRORS.inProgress,
    `${attempt.actor?.name ?? "Someone"} is answering this decision right now.`,
    { itemId, attempt: { ...attempt } },
  );
}

/**
 * The idempotency key was already used for a different press.
 *
 * @param key - The key.
 * @returns The error.
 */
export function decisionIdempotencyKeyReused(key: string): ConflictError {
  return new ConflictError(
    INBOX_ACTION_ERRORS.keyReused,
    "This idempotency key was already used for a different action or person.",
    { idempotencyKey: key },
  );
}

/**
 * The action is declared, but the plane that owns it has no operation yet.
 *
 * @param actionId - The action.
 * @param binding - Its handler binding.
 * @returns The error.
 */
export function decisionActionUnbound(actionId: string, binding: string): NotImplementedError {
  return new NotImplementedError(
    INBOX_ACTION_ERRORS.unbound,
    `Action ${actionId} cannot be answered from the inbox yet: ${binding} has no operation behind it.`,
    { actionId, binding },
  );
}

/**
 * The item lacks a ref (or source reference) its action needs.
 *
 * @param itemId - The item.
 * @param what - What is missing.
 * @returns The error.
 */
export function decisionItemRefMissing(itemId: string, what: string): ConflictError {
  return new ConflictError(
    INBOX_ACTION_ERRORS.refMissing,
    `Decision item ${itemId} names no ${what}, so this action has nothing to act on.`,
    { itemId, missing: what },
  );
}

/**
 * The grant was written but AP.3 still blocks the run — the inbox never decides writability.
 *
 * @param runId - The run.
 * @param details - The verdict AP.3 gave.
 * @returns The error.
 */
export function allowOnceStillBlocked(runId: string, details: ErrorDetails): ConflictError {
  return new ConflictError(
    INBOX_ACTION_ERRORS.stillBlocked,
    "The guardrails still block this run after the one-time allowance; nothing was granted.",
    { runId, ...details },
  );
}

/**
 * A bench-gap draft has no ticket source to target.
 *
 * @param prId - The PR.
 * @returns The error.
 */
export function benchUpgradeTargetMissing(prId: string): ConflictError {
  return new ConflictError(
    INBOX_ACTION_ERRORS.benchTargetMissing,
    "This PR has no ticket, so there is no tracker to draft the bench upgrade into.",
    { prId },
  );
}

/**
 * The merge executor's re-check refused and disarmed the plan.
 *
 * @param prId - The PR.
 * @param code - The refusal's code.
 * @param message - Its sentence.
 * @returns The error.
 */
export function mergeRefused(prId: string, code: string, message: string): ConflictError {
  return new ConflictError(INBOX_ACTION_ERRORS.mergeRefused, message, { prId, refusal: code });
}
