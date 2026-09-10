/**
 * How soon after a cycle another one may be *asked for* — the whole of the minimum-interval
 * guard, in one side-effect-free place.
 *
 * M.4 ([#113](https://github.com/NobuData/ouroboros/issues/113)): *"a minimum-interval guard so
 * a user clicking the freshness tag repeatedly cannot burn the org's GitHub rate limit"*.
 *
 * Separate from the service that enforces it for `github.rate-limit.ts`'s reason: the policy
 * and the refusal must not be able to disagree about what *too soon* means, and the way to
 * guarantee that is for both to call one function.
 */

/** Milliseconds in a second — the unit the interval is expressed in. */
const MILLISECONDS = 1000;

/**
 * The shortest gap between two backlog sync cycles a person may cause — thirty seconds.
 *
 * **A constant rather than a setting**, the way `RATE_LIMIT_FLOOR` is. What it protects is not
 * a matter of taste: a cycle costs roughly one GitHub request per enabled repository from a
 * budget of five thousand an hour, and thirty seconds bounds a person leaning on the freshness
 * tag to a hundred and twenty cycles an hour — small against the budget, and small against the
 * fifty requests the rate guard keeps back for whoever is actually waiting. A deployment that
 * wants this shorter wants a webhook (O.1,
 * [#123](https://github.com/NobuData/ouroboros/issues/123)) rather than a faster poll.
 *
 * **Short enough to be worth clicking**, which is the other half. The story this endpoint
 * exists for is somebody who has just filed an issue on GitHub and wants it in the backlog
 * *now*; a guard measured in minutes would send them back to waiting out the poll interval,
 * which is the thing the trigger removes.
 */
export const MINIMUM_SYNC_INTERVAL_SECONDS = 30;

/**
 * How long until a manual re-sync would be accepted, if it would not be now.
 *
 * Measured from the **last cycle's start**, whoever caused it — a scheduled tick, or another
 * member's click. That is deliberate and it is the honest reading of the criterion: a cycle
 * that began ten seconds ago has already asked GitHub for this workspace's issues, so a second
 * one buys nothing and spends the same budget again. Keeping a per-caller or per-workspace
 * counter instead would let one process run a cycle for every workspace in it, several seconds
 * apart, and each of those cycles polls **every** configured workspace.
 *
 * @param startedAt - When the last completed cycle began, or `undefined` when this process has
 *   completed none — in which case there is nothing to be too soon after, and the answer is to
 *   go ahead.
 * @param now - The clock.
 * @returns Whole seconds to wait, rounded up and never below one, or `undefined` when a cycle
 *   may be triggered. Rounded **up** because a hint that rounds down tells a client to retry a
 *   moment early and collect a second refusal.
 */
export function retryAfterSeconds(startedAt: Date | undefined, now: Date): number | undefined {
  if (startedAt === undefined) {
    return undefined;
  }

  const elapsed = now.getTime() - startedAt.getTime();
  const remaining = MINIMUM_SYNC_INTERVAL_SECONDS * MILLISECONDS - elapsed;

  if (remaining <= 0) {
    return undefined;
  }

  // A cycle whose `startedAt` is in the future is a clock that moved backwards rather than a
  // reason to refuse for hours: the wait is still bounded by the interval itself.
  return Math.min(MINIMUM_SYNC_INTERVAL_SECONDS, Math.max(1, Math.ceil(remaining / MILLISECONDS)));
}
