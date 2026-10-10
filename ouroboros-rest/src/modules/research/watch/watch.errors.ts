/**
 * The regression watch's refusals (CM.4, [#623](https://github.com/NobuData/ouroboros/issues/623)).
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../../errors/error.envelope";

export const WATCH_ERRORS = {
  /** This workspace has no such watch item. `404`. */
  itemNotFound: "regression_watch_item_not_found",
  /** The item is already merged or dismissed. `409`. */
  itemClosed: "regression_watch_item_closed",
  /** The workspace watches no metric of that repository, so there is nothing to capture. `422`. */
  nothingWatched: "regression_watch_nothing_watched",
  /** The settings name something that does not exist or cannot be stored. `422`. */
  settingsInvalid: "regression_watch_settings_invalid",
} as const;

/**
 * `404` — the workspace has no such item.
 *
 * @param itemId - The id asked for.
 * @returns The error.
 */
export function itemNotFound(itemId: string): NotFoundError {
  return new NotFoundError(
    WATCH_ERRORS.itemNotFound,
    "This workspace has no such regression watch item.",
    { itemId },
  );
}

/**
 * `409` — the item reached an end and stays there.
 *
 * @param itemId - The item.
 * @param status - `fixed_merged` or `dismissed`.
 * @returns The error.
 */
export function itemClosed(itemId: string, status: string): ConflictError {
  return new ConflictError(
    WATCH_ERRORS.itemClosed,
    "This regression watch item is already closed.",
    { itemId, status },
  );
}

/**
 * `422` — a capture was asked for a repository none of whose metrics are watched.
 *
 * @param repository - `owner/name`.
 * @returns The error.
 */
export function nothingWatched(repository: string): InvalidRequestError {
  return new InvalidRequestError(
    WATCH_ERRORS.nothingWatched,
    "No metric of that repository is watched. Add one to the regression watch settings first.",
    { repository },
  );
}

/**
 * `422` — the settings could not be stored as given.
 *
 * @param reason - What is wrong, in a sentence.
 * @param details - What it names.
 * @returns The error.
 */
export function settingsInvalid(
  reason: string,
  details: Record<string, unknown> = {},
): InvalidRequestError {
  return new InvalidRequestError(WATCH_ERRORS.settingsInvalid, reason, details);
}
