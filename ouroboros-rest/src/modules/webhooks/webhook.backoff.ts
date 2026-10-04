/**
 * When a failed delivery is tried again (BR.3, [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * ```
 * attempt   1    2     3     4      5 …
 * waits     30s  1m    2m    4m     8m … capped at 1h   (each ±10% jitter)
 * ```
 *
 * Exponential, so a receiver that is down for an hour is not hammered for an hour; capped, so a
 * long outage still gets an attempt every hour rather than one a week; jittered, so a fleet of
 * endpoints that all failed in the same second do not all retry in the same second.
 */

/** The wait after the first failure. */
export const BACKOFF_BASE_MS = 30_000;

/** The longest wait between attempts. */
export const BACKOFF_CAP_MS = 3_600_000;

/** The jitter, as a fraction of the wait, either way. */
export const BACKOFF_JITTER = 0.1;

/**
 * How long to wait before the attempt after a failed one.
 *
 * @param failedAttempt - The attempt that just failed, 1-based.
 * @param random - A source in [0, 1); `Math.random` by default, fixed in tests.
 * @returns Milliseconds until the next attempt is due.
 */
export function retryDelayMs(failedAttempt: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, failedAttempt - 1);
  const wait = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.min(exponent, 30));
  const jitter = (random() * 2 - 1) * BACKOFF_JITTER;

  return Math.round(wait * (1 + jitter));
}
