/**
 * What the copilot's own routes can refuse with — the codes, and one constructor each.
 *
 * The exchange itself never throws past the stream: once a reply is streaming, a failure is an
 * `error` event the conversation shows honestly (`copilot_unrouted`, `gateway_unavailable`),
 * because the person is watching a reply build and a `502` after the first token would be a
 * reply that vanished. The errors here are the ones answered *before* a stream opens.
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";

/** Every code this module answers with. The document (`openapi.yaml`) is the registry. */
export const COPILOT_ERRORS = {
  /** No active session for that workflow, or none this caller may know about. */
  sessionNotFound: "copilot_session_not_found",
  /** The workflow already has an active session (`copilot_sessions_one_active`). */
  sessionActive: "copilot_session_active",
  /** The session was promoted or discarded and takes no new messages. */
  sessionClosed: "copilot_session_closed",
  /** A reply is still streaming on this session; one exchange at a time. */
  exchangeBusy: "copilot_exchange_busy",
  /** No such message in that session. */
  messageNotFound: "copilot_message_not_found",
  /** The answer names a question the reply did not ask, an option it did not offer, or one already answered. */
  answerInvalid: "copilot_answer_invalid",
} as const;

/**
 * `404` — no active session for this workflow.
 *
 * @param workflowId - The workflow the request named, echoed into `details.workflowId`.
 * @returns The error to throw.
 */
export function sessionNotFound(workflowId: string): NotFoundError {
  return new NotFoundError(
    COPILOT_ERRORS.sessionNotFound,
    "This workflow has no active copilot session.",
    { workflowId },
  );
}

/**
 * `409` — the workflow already has an active session.
 *
 * @param sessionId - The session that is active, so the client can resume it.
 * @returns The error to throw.
 */
export function sessionActive(sessionId: string): ConflictError {
  return new ConflictError(
    COPILOT_ERRORS.sessionActive,
    "This workflow already has an active copilot session. Resume it instead.",
    { sessionId },
  );
}

/**
 * `409` — the session is closed.
 *
 * @param sessionId - The session.
 * @param status - Its terminal status.
 * @returns The error to throw.
 */
export function sessionClosed(sessionId: string, status: string): ConflictError {
  return new ConflictError(
    COPILOT_ERRORS.sessionClosed,
    `This copilot session was ${status} and takes no new messages.`,
    { sessionId, status },
  );
}

/**
 * `409` — a reply is still streaming.
 *
 * @param sessionId - The session.
 * @returns The error to throw.
 */
export function exchangeBusy(sessionId: string): ConflictError {
  return new ConflictError(
    COPILOT_ERRORS.exchangeBusy,
    "The copilot is still replying on this session. Wait for the reply to finish.",
    { sessionId },
  );
}

/**
 * `404` — no such message in the session.
 *
 * @param messageId - The id the request named.
 * @returns The error to throw.
 */
export function messageNotFound(messageId: string): NotFoundError {
  return new NotFoundError(COPILOT_ERRORS.messageNotFound, "No such copilot message.", {
    messageId,
  });
}

/**
 * `422` — the answer does not fit the question.
 *
 * @param reason - Which way, as a sentence.
 * @returns The error to throw.
 */
export function answerInvalid(reason: string): InvalidRequestError {
  return new InvalidRequestError(COPILOT_ERRORS.answerInvalid, reason);
}
