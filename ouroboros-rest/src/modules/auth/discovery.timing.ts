/**
 * Why domain discovery takes the same time whether or not the domain is one of ours.
 *
 * The endpoint's answer is uniform by construction — `discovery.service.ts` composes the
 * same object for a known domain and an unknown one — which closes the obvious half of
 * tenant enumeration and leaves the half that is not in the body at all. A lookup that hits
 * an index entry and returns a row is measurably slower than one that hits nothing, and a
 * caller with a domain list and a stopwatch can read the difference off a few hundred
 * requests even when every response is byte-identical. The issue's third acceptance
 * criterion is exactly that measurement: *response timing does not separate known from
 * unknown domains under measurement*.
 *
 * So the handler is given a floor. It does its work, and then waits until a fixed duration
 * has passed since it started, so what a caller times is the floor rather than the query.
 *
 * **This is a floor, not a constant.** Work that overruns {@link DISCOVERY_FLOOR_MS} is not
 * clamped — it cannot be, short of failing a request that succeeded — so the guarantee is
 * precisely: *while the work fits inside the floor, its duration is not observable*. That is
 * an honest guarantee for this endpoint and it is worth saying what makes it one. The work
 * is a single indexed existence check on a warm pool, which is a millisecond or two against
 * a floor two orders of magnitude larger; the two branches differ by a fraction of that; and
 * the case where the floor is genuinely exceeded is a database in trouble, where every
 * request is slow and the signal a caller reads is about the server rather than about their
 * domain. What would break it is a lookup that grew expensive — a second query, a join, a
 * network call to an identity provider — which is the note
 * [#722](https://github.com/NobuData/ouroboros/issues/722) will need when it fills the SSO
 * branch in: whatever it adds has to fit under the floor, or the floor has to move.
 *
 * **It is not rate limiting, and does not pretend to be.** A floor makes one request
 * uninformative; it does nothing about ten thousand of them, and delaying every caller into
 * a pile of held connections is a way to make that worse rather than better. Per-IP
 * throttling on this route is [#725](https://github.com/NobuData/ouroboros/issues/725), as
 * the issue and the roadmap both note.
 */

import { setTimeout as pause } from "node:timers/promises";

/**
 * How long every discovery request takes, at least.
 *
 * Two pressures set it. Below the noise of the work it hides — an indexed lookup, a pooled
 * connection, the driver's own variance — it hides nothing; far above, it is a login form
 * that feels broken. A tenth of a second is comfortably clear of the first and beneath what
 * a person waiting on a form notices, and the field it serves is filled in once per sign-in
 * rather than per keystroke.
 */
export const DISCOVERY_FLOOR_MS = 120;

/**
 * Run something, and do not answer before `floorMs` has passed.
 *
 * Measured on `performance.now()`, which is monotonic: a clock adjustment mid-request
 * cannot make the floor arbitrarily long or skip it entirely, which `Date.now()` can.
 *
 * The wait is in a `finally`, so a failure takes the floor too. That matters more than it
 * looks: an error is an answer, and an error that arrives faster for one input than another
 * separates them exactly as a success would.
 *
 * @param floorMs - The minimum duration of the whole call.
 * @param work - What to do. Its result — or its rejection — is this function's, unchanged.
 * @returns What `work` resolved to, no sooner than `floorMs` after this was called.
 * @throws Whatever `work` threw, no sooner than `floorMs` after this was called.
 */
export async function withFloor<T>(floorMs: number, work: () => Promise<T>): Promise<T> {
  const started = performance.now();

  try {
    return await work();
  } finally {
    const remaining = floorMs - (performance.now() - started);

    if (remaining > 0) {
      await pause(remaining);
    }
  }
}
