/**
 * The two ways a manual re-sync is refused, and the words for them.
 *
 * M.4 ([#113](https://github.com/NobuData/ouroboros/issues/113)). Both are `409`: the request
 * is well-formed, the caller may make it, everything it names exists — and the *state* refuses
 * it. A client that retries either one unchanged, immediately, gets the same answer, which is
 * `ConflictError`'s own definition.
 *
 * **They are two codes rather than one because the reader's next move differs.** *Already
 * running* means the thing you asked for is happening: watch it. *Too soon* means it happened
 * a moment ago and asking again buys nothing: wait the number of seconds in the envelope. A
 * single `sync_refused` would leave a client unable to tell "we're on it" from "you're early",
 * which are the two states the freshness tag has to render differently.
 *
 * **Neither is a `429`.** `TooManyRequestsError` is *the caller has done this too often* and
 * belongs to a per-caller budget; this is a **process-wide** guard on a loop the caller does
 * not own, and the same refusal is given to a person who has clicked nothing. `github.errors.ts`
 * makes the same call for the same reason.
 */

import { ConflictError } from "../errors/error.envelope";
import { MINIMUM_SYNC_INTERVAL_SECONDS } from "./debounce";

/**
 * The codes, as one object.
 *
 * `as const` so each value is its own literal type, and `sync.errors.spec.ts` holds them to
 * `openapi.yaml` — the document is the registry a client reads, so a code that is not in it is
 * a code nobody can look up.
 */
export const BACKLOG_SYNC_ERRORS = {
  /** A cycle is in flight. The caller's request would be the second walk of the same repos. */
  running: "backlog_sync_running",
  /** A cycle ran within the minimum interval. See `details.retryAfterSeconds`. */
  tooSoon: "backlog_sync_too_soon",
} as const;

/** One of {@link BACKLOG_SYNC_ERRORS}' values. */
export type BacklogSyncErrorCode = (typeof BACKLOG_SYNC_ERRORS)[keyof typeof BACKLOG_SYNC_ERRORS];

/**
 * `409` — a cycle is already running.
 *
 * **It carries no `retryAfterSeconds`, deliberately.** How long a cycle takes depends on how
 * many repositories are enabled across the installation and how quickly GitHub answers, and a
 * number invented here would be rendered as a countdown that means nothing —
 * `github.errors.ts`' rule about omitting rather than guessing, applied to this service's own
 * state. What a client should do instead is read `GET /api/v1/backlog/sync-status`, whose
 * `running` flag is the actual signal.
 *
 * @returns The error to throw.
 */
export function syncAlreadyRunning(): ConflictError {
  return new ConflictError(
    BACKLOG_SYNC_ERRORS.running,
    "A backlog sync is already running. It will finish on its own.",
  );
}

/**
 * `409` — a cycle ran too recently for another one to be worth its requests.
 *
 * @param retryAfterSeconds - Whole seconds until a trigger would be accepted, rounded up and
 *   never below one. The retry hint the acceptance criterion asks for, and a number rather
 *   than a `Retry-After` header for the reason `TooManyRequestsError` documents: this
 *   service's contract is the envelope, so a client that already branches on `details` should
 *   not need a second reader to learn the one fact that makes the refusal actionable.
 * @returns The error to throw.
 */
export function syncTooSoon(retryAfterSeconds: number): ConflictError {
  return new ConflictError(
    BACKLOG_SYNC_ERRORS.tooSoon,
    `The backlog was synced less than ${String(MINIMUM_SYNC_INTERVAL_SECONDS)} seconds ago. ` +
      "Try again shortly.",
    { retryAfterSeconds },
  );
}
