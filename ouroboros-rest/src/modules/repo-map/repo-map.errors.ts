/**
 * The repo-map generator's refusals (BF.6, [#415](https://github.com/NobuData/ouroboros/issues/415)).
 */

import { ConflictError } from "../errors/error.envelope";

/** The codes, as one object. */
export const REPO_MAP_ERRORS = {
  /** A regenerate inside the debounce window. */
  tooSoon: "repo_map_regenerate_too_soon",
} as const;

/**
 * `409` — the map was regenerated a moment ago; another pass would spend the host's requests on the
 * same answer (#101's discipline).
 *
 * @param retryAfterSeconds - Whole seconds until a regenerate would be accepted.
 * @returns The error.
 */
export function regenerateTooSoon(retryAfterSeconds: number): ConflictError {
  return new ConflictError(
    REPO_MAP_ERRORS.tooSoon,
    "This repository's map was regenerated a moment ago. Try again shortly.",
    { retryAfterSeconds },
  );
}
