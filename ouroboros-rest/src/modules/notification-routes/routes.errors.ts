/**
 * The notification routes API's refusals (BR.4, [#488](https://github.com/NobuData/ouroboros/issues/488)).
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";

/** Every code this module raises. */
export const ROUTE_ERRORS = {
  kindUnknown: "notification_route_kind_unknown",
  configInvalid: "notification_route_config_invalid",
  locked: "notification_route_locked",
} as const;

/**
 * The path names no route kind V094 accepts.
 *
 * @param kind - The kind asked for.
 * @returns A `404`.
 */
export function routeKindUnknown(kind: string): NotFoundError {
  return new NotFoundError(
    ROUTE_ERRORS.kindUnknown,
    "No such notification route. Kinds are needs_you_dm, daily_digest, loop_failures, weekly_insights or custom:<slug>.",
    { kind },
  );
}

/**
 * The route's config is malformed.
 *
 * @param fields - The problems, keyed by field (`config.time`).
 * @returns A `422` whose `details.fields` a form highlights.
 */
export function routeConfigInvalid(fields: Record<string, string[]>): InvalidRequestError {
  const first = Object.values(fields)[0]?.[0] ?? "The route's config is malformed.";

  return new InvalidRequestError(ROUTE_ERRORS.configInvalid, first, { fields });
}

/**
 * The locked-row rule: a route whose channel cannot deliver may not be enabled. The `reason` is
 * the sentence the card prints beside the lock (*connect PagerDuty first*), so the refusal of a
 * direct API call says exactly what the UI says.
 *
 * @param kind - The route.
 * @param channel - Its channel.
 * @param reason - Why the channel cannot deliver.
 * @returns A `409`.
 */
export function routeLocked(kind: string, channel: string, reason: string): ConflictError {
  return new ConflictError(
    ROUTE_ERRORS.locked,
    `The ${kind} route cannot be enabled on ${channel}: ${reason}.`,
    { kind, channel, locked: true, reason },
  );
}
