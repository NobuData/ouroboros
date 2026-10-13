/**
 * The refusals the chat routes answer with (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537); BZ.5,
 * [#539](https://github.com/NobuData/ouroboros/issues/539); CA.2,
 * [#542](https://github.com/NobuData/ouroboros/issues/542)).
 */

import { ForbiddenError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";

/** `403` — a route that acts as a person was called by somebody who is not one. */
export const CHAT_PERSON_REQUIRED = "chat_person_required";

/** `404` — no console command of the caller's has that id. */
export const CHAT_COMMAND_NOT_FOUND = "chat_command_not_found";

/** `404` — the workspace has no channel by that id that the route may address. */
export const CHAT_CHANNEL_NOT_FOUND = "chat_channel_not_found";

/** `422` — a mirror was asked for the page before a cursor this service did not issue. */
export const CHAT_CURSOR_INVALID = "chat_cursor_invalid";

/** What each person-only route says when it is asked by nobody in particular. */
const PERSON_ONLY = {
  completions: "Command completions are offered to a signed-in member, not to a service account.",
  commands: "Commands are run by a signed-in member, not by a service account.",
} as const;

/**
 * Completions are offered to a member — a source may show only what *they* can see — and a
 * command acts as the person who typed it: a service account is nobody in particular.
 *
 * @param route - Which route was asked.
 * @returns The error to throw.
 */
export function chatPersonRequired(
  route: keyof typeof PERSON_ONLY = "completions",
): ForbiddenError {
  return new ForbiddenError(CHAT_PERSON_REQUIRED, PERSON_ONLY[route]);
}

/**
 * A console command is read back only by the person who typed it, in the workspace they typed
 * it in. Somebody else's, a Slack command, another workspace's and an id that names nothing are
 * one answer, so the route does not say which ids exist.
 *
 * @returns The error to throw.
 */
export function chatCommandNotFound(): NotFoundError {
  return new NotFoundError(
    CHAT_COMMAND_NOT_FOUND,
    "No command you ran from the console has that id in this workspace.",
  );
}

/**
 * A channel is addressed by its row in this workspace. An id that is not a UUID, another
 * workspace's channel, a DM conversation the publisher opened — and, for a command typed under a
 * mirror, a channel that is not bound — are one answer, so the route does not say which ids
 * exist.
 *
 * @returns The error to throw.
 */
export function chatChannelNotFound(): NotFoundError {
  return new NotFoundError(CHAT_CHANNEL_NOT_FOUND, "This workspace has no such chat channel.");
}

/**
 * A mirror's `before` is the `olderCursor` of a page this service answered — never a guess. A
 * token that does not decode is refused rather than read as *the newest page*: a scroll that
 * silently restarted would show the same entries twice.
 *
 * @returns The error to throw.
 */
export function chatCursorInvalid(): InvalidRequestError {
  const message = "before is not a cursor this service issued; start again from the newest page.";

  return new InvalidRequestError(CHAT_CURSOR_INVALID, message, { fields: { before: [message] } });
}
