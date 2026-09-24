/**
 * The refusals of the PR sync, as the error envelope carries them.
 *
 * AX.1 ([#357](https://github.com/NobuData/ouroboros/issues/357)). Two, both about the source rather
 * than the PR: a host's own refusals arrive as the provider's `TicketSourceError`, classified, and
 * are not re-wrapped here.
 */

import { ConflictError, NotFoundError } from "../errors/error.envelope";

/** The `code` of each refusal. */
export const PR_SYNC_ERRORS = Object.freeze({
  /** The workspace has no such source. `404`. */
  sourceNotFound: "pr_source_not_found",
  /** The source's provider declares no pull requests — a ticket tracker. `409`. */
  noPullRequests: "pr_source_has_no_pull_requests",
});

/**
 * @param sourceId - The source asked about.
 * @returns The `404` for a source this workspace does not have.
 */
export function prSourceNotFound(sourceId: string): NotFoundError {
  return new NotFoundError(PR_SYNC_ERRORS.sourceNotFound, "This workspace has no such source.", {
    sourceId,
  });
}

/**
 * @param sourceId - The source asked about.
 * @returns The `409` for a source whose tracker has no pull requests.
 */
export function prSourceHasNoPullRequests(sourceId: string): ConflictError {
  return new ConflictError(
    PR_SYNC_ERRORS.noPullRequests,
    "This source's tracker has no pull requests — only a git host does.",
    { sourceId },
  );
}
