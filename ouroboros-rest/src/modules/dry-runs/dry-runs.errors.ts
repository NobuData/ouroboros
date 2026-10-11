/**
 * What the dry-run routes can refuse with — the codes, and one constructor each (CD.4,
 * [#562](https://github.com/NobuData/ouroboros/issues/562)).
 *
 * These are the refusals answered *before* a dry run exists. Once a run is recorded, what goes
 * wrong is part of its record — `failed` with a reason, a pre-check's findings, a populated
 * guard audit — because a person is watching a card, and an error envelope after the first
 * stage would be a card that vanished.
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";

/** Every code this module answers with. The document (`openapi.yaml`) is the registry. */
export const DRY_RUN_ERRORS = {
  /** No such dry run of that workflow, or none this caller may know about. */
  notFound: "dry_run_not_found",
  /** No such canonical ticket in this workspace. */
  ticketNotFound: "dry_run_ticket_not_found",
  /** The draft moved since the caller read it. */
  draftStale: "dry_run_draft_stale",
  /** The workflow already has a dry run that has not ended. */
  inProgress: "dry_run_in_progress",
  /** The ticket names no repository this workspace mirrors, so nothing can be read. */
  repositoryUnresolved: "dry_run_repository_unresolved",
  /** The ticket's tracker is not one a workflow trigger can name. */
  sourceUnsupported: "dry_run_source_unsupported",
  /** The session named is not a conversation about this workflow. */
  sessionMismatch: "dry_run_session_mismatch",
  /** The dry run has already ended, so there is nothing to cancel. */
  notRunning: "dry_run_not_running",
} as const;

/**
 * `404` — no such dry run.
 *
 * @param dryRunId - The id the request named, echoed into `details.dryRunId`.
 * @returns The error to throw.
 */
export function dryRunNotFound(dryRunId: string): NotFoundError {
  return new NotFoundError(DRY_RUN_ERRORS.notFound, "This workflow has no such dry run.", {
    dryRunId,
  });
}

/**
 * `404` — no such ticket in this workspace.
 *
 * @param ticketId - The id the request named.
 * @returns The error to throw.
 */
export function dryRunTicketNotFound(ticketId: string): NotFoundError {
  return new NotFoundError(DRY_RUN_ERRORS.ticketNotFound, "No such ticket in this workspace.", {
    ticketId,
  });
}

/**
 * `409` — the draft is not at the revision the caller named.
 *
 * @param requested - The revision the request named.
 * @param current - The revision the draft is at.
 * @returns The error to throw.
 */
export function dryRunDraftStale(requested: number, current: number): ConflictError {
  return new ConflictError(
    DRY_RUN_ERRORS.draftStale,
    "The draft changed since you opened it. Reload it and start the dry run again.",
    { requestedDraftRev: requested, currentDraftRev: current },
  );
}

/**
 * `409` — a dry run of this workflow is still going.
 *
 * @param dryRunId - The run that is open, so the client can follow or cancel it.
 * @returns The error to throw.
 */
export function dryRunInProgress(dryRunId: string): ConflictError {
  return new ConflictError(
    DRY_RUN_ERRORS.inProgress,
    "This workflow already has a dry run in progress. Follow it, or cancel it first.",
    { dryRunId },
  );
}

/**
 * `422` — the ticket names no repository the workspace mirrors.
 *
 * @param ticketKey - The ticket, as it is displayed.
 * @returns The error to throw.
 */
export function dryRunRepositoryUnresolved(ticketKey: string): InvalidRequestError {
  return new InvalidRequestError(
    DRY_RUN_ERRORS.repositoryUnresolved,
    `${ticketKey} names no repository this workspace mirrors, so a dry run has nothing to read.`,
    { ticket: ticketKey },
  );
}

/**
 * `422` — the ticket's tracker is not one a trigger can name.
 *
 * @param ticketKey - The ticket, as it is displayed.
 * @param kind - Its source's kind.
 * @returns The error to throw.
 */
export function dryRunSourceUnsupported(ticketKey: string, kind: string): InvalidRequestError {
  return new InvalidRequestError(
    DRY_RUN_ERRORS.sourceUnsupported,
    `${ticketKey} comes from a ${kind} source, which a workflow trigger cannot name.`,
    { ticket: ticketKey, source: kind },
  );
}

/**
 * `422` — the session is not a conversation about this workflow.
 *
 * @param sessionId - The session the request named.
 * @returns The error to throw.
 */
export function dryRunSessionMismatch(sessionId: string): InvalidRequestError {
  return new InvalidRequestError(
    DRY_RUN_ERRORS.sessionMismatch,
    "That copilot session is not a conversation about this workflow.",
    { sessionId },
  );
}

/**
 * `409` — the dry run has ended.
 *
 * @param dryRunId - The dry run.
 * @param status - Its terminal status.
 * @returns The error to throw.
 */
export function dryRunNotRunning(dryRunId: string, status: string): ConflictError {
  return new ConflictError(
    DRY_RUN_ERRORS.notRunning,
    `This dry run is already ${status.replace("_", " ")}; there is nothing to cancel.`,
    { dryRunId, status },
  );
}
