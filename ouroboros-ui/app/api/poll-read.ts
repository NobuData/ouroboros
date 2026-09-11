/**
 * One read made on behalf of a poll, answered in the loop's four cases
 * ([#117](https://github.com/NobuData/ouroboros/issues/117), shared since
 * [#119](https://github.com/NobuData/ouroboros/issues/119)).
 *
 * `app/api/backlog-page.ts` was the first server-side half of a poll over a read that answers
 * no `ETag` — every answer a `200` or a refusal — and `app/api/backlog-detail.ts` is the second.
 * The translation between them is the same: what came back is *fresh*; a `401` is *gone* rather
 * than a redirect a `fetch` nobody sees would follow; any other refusal carries the service's
 * own sentence; and a read that never reached the service — a dropped connection, the deadline
 * — carries the caller's. Written once, so the two readers cannot disagree about which failure
 * says what.
 *
 * **It does not throw**, because the caller is a route handler answering a poll and there is
 * no error boundary behind it that could render anything better than the poll itself can.
 *
 * **Framework-free and value-only**, the way `app/api/poll-response.ts` is: it reads nothing
 * from the environment or the session, and the client the read goes through is the caller's.
 */

import { isApiError } from "@/app/api/errors";
import type { PollAnswer } from "@/app/poll";

/**
 * How long a poll's read waits before giving up, in milliseconds.
 *
 * Comfortably inside the contract's fifteen-second cadence, so a service that has stopped
 * answering costs one slow poll rather than a queue of overlapping ones — the poll does not
 * start a second request while one is in flight, so a read that never resolved would stop the
 * loop altogether rather than merely slow it.
 */
export const POLL_READ_TIMEOUT_MS = 10_000;

/**
 * Make one read for a poll.
 *
 * @param read How to make it, given the deadline to hand the wire.
 * @param unreachable What to say when nothing answered at all — the reader's own sentence,
 *   since the distinction between a dropped connection and the deadline is one only a log can
 *   act on.
 * @returns The answer — the payload as *fresh*, *gone* for a session that has ended, or a
 *   sentence about why not.
 * @typeParam T What the read returns.
 */
export async function readForPoll<T>(
  read: (signal: AbortSignal) => Promise<T>,
  unreachable: string,
): Promise<PollAnswer<T>> {
  try {
    const payload = await read(AbortSignal.timeout(POLL_READ_TIMEOUT_MS));

    return { state: "fresh", payload, etag: null, pollAfterSeconds: null };
  } catch (error) {
    // Whatever was not an answer from the service — a `TypeError` for a dropped connection, a
    // `TimeoutError` for the deadline — says the same thing to a reader looking at a screen.
    if (!isApiError(error)) {
      return { state: "failed", reason: unreachable, pollAfterSeconds: null };
    }

    if (error.isUnauthenticated) return { state: "gone" };

    // The service's own sentence: every message in the contract's envelope is written for a
    // person and names nothing internal (`app/api/errors.ts`).
    return { state: "failed", reason: error.message, pollAfterSeconds: null };
  }
}
