/**
 * The refusals the chat routes answer with (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537); BZ.5,
 * [#539](https://github.com/NobuData/ouroboros/issues/539)).
 */

import { ForbiddenError, NotFoundError } from "../errors/error.envelope";

/** `403` — a route that acts as a person was called by somebody who is not one. */
export const CHAT_PERSON_REQUIRED = "chat_person_required";

/** `404` — no console command of the caller's has that id. */
export const CHAT_COMMAND_NOT_FOUND = "chat_command_not_found";

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
