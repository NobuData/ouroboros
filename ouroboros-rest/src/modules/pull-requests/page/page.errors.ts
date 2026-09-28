/**
 * The refusals of the PR page's reads and head actions — AX.5
 * ([#361](https://github.com/NobuData/ouroboros/issues/361)).
 *
 * A PR of another workspace is `404 pull_request_not_found`, like an absent one — the criteria
 * routes' error, reused so a client branches on one code for the whole PR plane. Each refusal here
 * names what the caller can fix.
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../../errors/error.envelope";

export const PAGE_ERRORS = {
  /** A head action on a merged or closed PR — the host owns those states. */
  pullRequestNotOpen: "pull_request_not_open",

  /** The PR has no revision yet, so there is nothing to judge, return or approve. */
  pullRequestHasNoRevision: "pull_request_has_no_revision",

  /** *Return to loop* on a PR no loop opened — there is no agent to send the failures back to. */
  pullRequestHasNoRun: "pull_request_has_no_run",

  /** A `revisionId` that is not one of this PR's revisions. */
  revisionNotFound: "pr_revision_not_found",

  /** A selected gate that is not red on the revision — only failures go back to the loop. */
  gateNotRed: "pr_gate_not_red",

  /** A decline with no note — a red gate says why. */
  declineNoteRequired: "pr_decline_note_required",

  /** An `entryId` that is not an entry of this PR's review thread. */
  threadEntryNotFound: "pr_thread_entry_not_found",

  /** The entry is already resolved — a resolution, and its reply, are fixed (V057). */
  threadEntryResolved: "pr_thread_entry_resolved",

  /** A policy entry states a rule; there is nothing in it to resolve. */
  threadEntryNotResolvable: "pr_thread_entry_not_resolvable",

  /** A mirror asked for with no reply — there is nothing to post to the host. */
  threadMirrorNeedsReply: "pr_thread_mirror_needs_reply",
} as const;

/**
 * @param prId - The PR.
 * @param state - Where it stands.
 * @returns `409 pull_request_not_open`.
 */
export function pullRequestNotOpen(prId: string, state: string): ConflictError {
  return new ConflictError(
    PAGE_ERRORS.pullRequestNotOpen,
    `The pull request is ${state}; the host owns it now, and nothing can be sent back or approved.`,
    { prId, state },
  );
}

/**
 * @param prId - The PR.
 * @returns `409 pull_request_has_no_revision`.
 */
export function pullRequestHasNoRevision(prId: string): ConflictError {
  return new ConflictError(
    PAGE_ERRORS.pullRequestHasNoRevision,
    "The pull request has no revision recorded yet — sync it first.",
    { prId },
  );
}

/**
 * @param prId - The PR.
 * @returns `409 pull_request_has_no_run`.
 */
export function pullRequestHasNoRun(prId: string): ConflictError {
  return new ConflictError(
    PAGE_ERRORS.pullRequestHasNoRun,
    "No loop opened this pull request, so there is no agent to return its failures to.",
    { prId },
  );
}

/**
 * @param prId - The PR.
 * @param revisionId - The revision asked for.
 * @returns `404 pr_revision_not_found`.
 */
export function revisionNotFound(prId: string, revisionId: string): NotFoundError {
  return new NotFoundError(PAGE_ERRORS.revisionNotFound, "No such revision on this pull request.", {
    prId,
    revisionId,
  });
}

/**
 * @param revisionId - The revision judged.
 * @param gates - Each selected gate that is not red, with the verdict it has (`null` when the PR has
 *   no such gate or it was never evaluated on the revision).
 * @returns `422 pr_gate_not_red`.
 */
export function gateNotRed(
  revisionId: string,
  gates: readonly { readonly key: string; readonly verdict: string | null }[],
): InvalidRequestError {
  return new InvalidRequestError(
    PAGE_ERRORS.gateNotRed,
    "Only red gates can be returned to the loop — their evidence is what the steer carries.",
    { revisionId, gates },
  );
}

/** @returns `422 pr_decline_note_required`. */
export function declineNoteRequired(): InvalidRequestError {
  return new InvalidRequestError(
    PAGE_ERRORS.declineNoteRequired,
    "A decline needs a note: the human-approval gate goes red, and it has to say why.",
  );
}

/**
 * @param prId - The PR.
 * @param entryId - The entry asked for.
 * @returns `404 pr_thread_entry_not_found`.
 */
export function threadEntryNotFound(prId: string, entryId: string): NotFoundError {
  return new NotFoundError(
    PAGE_ERRORS.threadEntryNotFound,
    "No such entry on this pull request's review thread.",
    { prId, entryId },
  );
}

/**
 * @param entryId - The entry.
 * @returns `409 pr_thread_entry_resolved`.
 */
export function threadEntryResolved(entryId: string): ConflictError {
  return new ConflictError(
    PAGE_ERRORS.threadEntryResolved,
    "The entry is already resolved — a resolution and its reply are not rewritten.",
    { entryId },
  );
}

/**
 * @param entryId - The entry.
 * @returns `409 pr_thread_entry_not_resolvable`.
 */
export function threadEntryNotResolvable(entryId: string): ConflictError {
  return new ConflictError(
    PAGE_ERRORS.threadEntryNotResolvable,
    "A policy entry states the rule that applied; there is nothing in it to resolve.",
    { entryId },
  );
}

/** @returns `422 pr_thread_mirror_needs_reply`. */
export function threadMirrorNeedsReply(): InvalidRequestError {
  return new InvalidRequestError(
    PAGE_ERRORS.threadMirrorNeedsReply,
    "Mirroring to the host needs a reply: the reply is what is posted.",
  );
}
