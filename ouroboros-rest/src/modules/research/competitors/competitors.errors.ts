/**
 * The competitor registry's refusals (CL.3, [#616](https://github.com/NobuData/ouroboros/issues/616)).
 *
 * Each code is stable and is what a client branches on; the sentences are for people.
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../../errors/error.envelope";

export const COMPETITOR_ERRORS = {
  /** This workspace has no such rival. `404`. */
  competitorNotFound: "competitor_not_found",
  /** This rival has no such watch. `404`. */
  watchNotFound: "competitor_watch_not_found",
  /** The workspace already has a rival by that name, however capitalised. `409`. */
  nameTaken: "competitor_name_taken",
  /** The rival already watches that kind, URL and selector. `409`. */
  watchExists: "competitor_watch_exists",
  /** An investigation cites one of its snapshots, so it stays — disable it instead. `409`. */
  cited: "competitor_cited",
  /** A rival may have at most {@link MAX_WATCHES_PER_COMPETITOR} watches. `409`. */
  tooManyWatches: "competitor_watch_limit",
  /** The selector is outside the supported CSS subset, or the kind takes none. `422`. */
  selectorInvalid: "competitor_selector_invalid",
  /** The URL does not suit the kind — a `github_releases` watch names a GitHub repository. `422`. */
  urlInvalid: "competitor_watch_url_invalid",
} as const;

/** The most watches one rival may have — enough for every kind, several pages of each. */
export const MAX_WATCHES_PER_COMPETITOR = 25;

/**
 * `404` — the workspace has no such rival.
 *
 * @param competitorId - The id asked for.
 * @returns The error.
 */
export function competitorNotFound(competitorId: string): NotFoundError {
  return new NotFoundError(
    COMPETITOR_ERRORS.competitorNotFound,
    "This workspace has no such rival.",
    {
      competitorId,
    },
  );
}

/**
 * `404` — the rival has no such watch.
 *
 * @param watchId - The id asked for.
 * @returns The error.
 */
export function watchNotFound(watchId: string): NotFoundError {
  return new NotFoundError(COMPETITOR_ERRORS.watchNotFound, "This rival has no such watch.", {
    watchId,
  });
}

/**
 * `409` — the name is the workspace's already.
 *
 * @param name - The name asked for.
 * @returns The error.
 */
export function nameTaken(name: string): ConflictError {
  return new ConflictError(
    COMPETITOR_ERRORS.nameTaken,
    "This workspace already has a rival by that name.",
    { name },
  );
}

/**
 * `409` — the rival already has that watch.
 *
 * @returns The error.
 */
export function watchExists(): ConflictError {
  return new ConflictError(
    COMPETITOR_ERRORS.watchExists,
    "This rival already watches that source with that selector.",
  );
}

/**
 * `409` — an investigation cites an archived change of it.
 *
 * @param what - `rival` or `watch`.
 * @returns The error.
 */
export function cited(what: "rival" | "watch"): ConflictError {
  return new ConflictError(
    COMPETITOR_ERRORS.cited,
    `An investigation cites a change archived for this ${what}, so it cannot be removed. Disable its watches instead.`,
  );
}

/**
 * `409` — the rival has as many watches as it may.
 *
 * @returns The error.
 */
export function tooManyWatches(): ConflictError {
  return new ConflictError(
    COMPETITOR_ERRORS.tooManyWatches,
    `A rival may have at most ${String(MAX_WATCHES_PER_COMPETITOR)} watches.`,
    { limit: MAX_WATCHES_PER_COMPETITOR },
  );
}

/**
 * `422` — the selector cannot be used.
 *
 * @param reason - Why, from the parser or the kind.
 * @returns The error.
 */
export function selectorInvalid(reason: string): InvalidRequestError {
  return new InvalidRequestError(
    COMPETITOR_ERRORS.selectorInvalid,
    `The selector cannot be used: ${reason}.`,
    {
      fields: { selector: [reason] },
    },
  );
}

/**
 * `422` — the URL does not suit the kind.
 *
 * @param reason - Why.
 * @returns The error.
 */
export function urlInvalid(reason: string): InvalidRequestError {
  return new InvalidRequestError(
    COMPETITOR_ERRORS.urlInvalid,
    `The URL cannot be watched: ${reason}.`,
    {
      fields: { url: [reason] },
    },
  );
}
