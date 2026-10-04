/**
 * The decision channels' JSON refusals (BN.3, [#463](https://github.com/NobuData/ouroboros/issues/463)).
 *
 * The token confirm page never answers JSON — a person arrives there from a mail — so its outcomes
 * are designed pages (`answer/answer.pages.ts`), not errors. These are the preference routes'.
 */

import { ForbiddenError, InvalidRequestError } from "../errors/error.envelope";

/** Every code this module answers with. */
export const CHANNEL_ERRORS = {
  needsPerson: "notification_preferences_need_person",
  unknownKind: "notification_kind_unknown",
} as const;

/**
 * A caller with no signed-in person — a service account has no mailbox and no preferences.
 *
 * @returns The error.
 */
export function preferencesNeedPerson(): ForbiddenError {
  return new ForbiddenError(
    CHANNEL_ERRORS.needsPerson,
    "Notification preferences belong to a person; a service account has none.",
  );
}

/**
 * A muted kind no declaration names.
 *
 * @param kinds - The unknown kind ids.
 * @returns The error.
 */
export function notificationKindUnknown(kinds: readonly string[]): InvalidRequestError {
  return new InvalidRequestError(
    CHANNEL_ERRORS.unknownKind,
    `No decision kind is declared as ${kinds.join(", ")}.`,
    { mutedKinds: [...kinds] },
  );
}
