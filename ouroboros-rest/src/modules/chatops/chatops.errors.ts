/**
 * The refusals the chat routes answer with (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 */

import { ForbiddenError } from "../errors/error.envelope";

/** `403` — completions were asked for by a caller who is not a person. */
export const CHAT_PERSON_REQUIRED = "chat_person_required";

/**
 * Completions are offered to a member: a source may show only what *they* can see, and a service
 * account is nobody in particular.
 *
 * @returns The error to throw.
 */
export function chatPersonRequired(): ForbiddenError {
  return new ForbiddenError(
    CHAT_PERSON_REQUIRED,
    "Command completions are offered to a signed-in member, not to a service account.",
  );
}
