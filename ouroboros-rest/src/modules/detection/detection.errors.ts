/**
 * The detection API's refusals ([#384](https://github.com/NobuData/ouroboros/issues/384)), each a
 * code `openapi.yaml` publishes.
 */

import { ConflictError, NotFoundError } from "../errors/error.envelope";

/** The codes, as one object. */
export const DETECTION_ERRORS = {
  /** No connected source covers the repository, or none that can probe it. */
  sourceMissing: "detection_source_missing",
  /** The repository was scanned a moment ago. `details.retryAfterSeconds` says how long to wait. */
  rescanTooSoon: "detection_rescan_too_soon",
  /** The repository has no scan with that number. */
  scanNotFound: "detection_scan_not_found",
} as const;

/**
 * `409` — nothing connected to this workspace can probe the repository. Connecting GitHub (step
 * 1) and listing the repository on the source (step 2) is the fix, so the state refuses rather
 * than the request.
 *
 * @param repo - `owner/name`.
 * @returns The error.
 */
export function sourceMissing(repo: string): ConflictError {
  return new ConflictError(
    DETECTION_ERRORS.sourceMissing,
    `No connected source covers ${repo}, so it cannot be scanned.`,
    { repo },
  );
}

/**
 * `409` — a re-scan inside the debounce window. The scan a moment ago already spent the host's
 * requests; another buys nothing.
 *
 * @param retryAfterSeconds - Whole seconds until a re-scan would be accepted.
 * @returns The error.
 */
export function rescanTooSoon(retryAfterSeconds: number): ConflictError {
  return new ConflictError(
    DETECTION_ERRORS.rescanTooSoon,
    "This repository was scanned a moment ago. Try again shortly.",
    { retryAfterSeconds },
  );
}

/**
 * `404` — no scan with that number, in this workspace.
 *
 * @param repo - `owner/name`.
 * @param scanSeq - The number asked for.
 * @returns The error.
 */
export function scanNotFound(repo: string, scanSeq: number): NotFoundError {
  return new NotFoundError(
    DETECTION_ERRORS.scanNotFound,
    `${repo} has no scan ${String(scanSeq)}.`,
    {
      repo,
      scanSeq,
    },
  );
}
