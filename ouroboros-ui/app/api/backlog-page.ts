import "server-only";

/**
 * One page of the backlog, read on behalf of the table's poll
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)).
 *
 * `app/api/dashboard-summary.ts` is the same seam for the dashboard: the server's half of a
 * poll, answering in `app/poll.ts`'s four cases so that `app/api/backlog/route.ts` can turn
 * the answer into HTTP and `app/issues/backlog-poll.ts` can read it back out. The difference
 * is what it reads through. M.1's listing answers no `ETag` and no `X-Ouro-Poll-After` —
 * every answer is a `200` or a refusal — so there is no `304` for the typed client's
 * middleware to turn into a throw, and the read goes through `app/api/backlog.ts` like every
 * other call to that operation. What the typed client contributes is kept: the query is typed
 * against the contract, and the session travels as the same two cookies every render sends.
 *
 * ### The client is the one that does not redirect
 *
 * `anonymousApi()` rather than `api()`, for the reason `app/api/dashboard-summary.ts` gives:
 * this read is made on behalf of a poll, not of a render. A `401` through `api()` would throw
 * Next.js's redirect signal out of a route handler and answer the poll with a `307` to a login
 * page, which the poll would then try to read as a backlog. Through `anonymousApi()` it is an
 * `ApiError` this module reads as *gone*, and what the screen does about that is decided in
 * the browser, where a person is.
 *
 * ### It does not throw
 *
 * Every outcome is one of the four answers, because the caller is a route handler answering a
 * poll and there is no error boundary behind it that could render anything better than the
 * poll itself can. A refusal carries the service's own sentence; a read that never reached the
 * service — a dropped connection, or the timeout below — carries this module's.
 */

import { type BacklogListing, type BacklogQuery, backlog } from "@/app/api/backlog";
import { isApiError } from "@/app/api/errors";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_BACKLOG } from "@/app/issues/backlog-poll";
import type { PollAnswer } from "@/app/poll";

/**
 * How long to wait for the listing before giving up, in milliseconds.
 *
 * Comfortably inside the contract's fifteen-second cadence, so a service that has stopped
 * answering costs one slow poll rather than a queue of overlapping ones — the poll does not
 * start a second request while one is in flight, so a read that never resolved would stop the
 * loop altogether rather than merely slow it.
 */
export const BACKLOG_TIMEOUT_MS = 10_000;

/**
 * Read one page of the backlog for a poll.
 *
 * @param query The page's query — the filter bar's controls and the page as `limit`/`offset`,
 *   as `app/issues/paging.ts` spells them.
 * @param read How to make the read. Defaults to the typed client over the session's cookies;
 *   tests pass a stub.
 * @returns The answer — the listing, *gone* for a session that has ended, or a sentence about
 *   why not.
 */
export async function readBacklogPage(
  query: BacklogQuery,
  read: (query: BacklogQuery, signal: AbortSignal) => Promise<BacklogListing> = (
    asked,
    signal,
  ) => backlog.list(asked, anonymousApi(), signal),
): Promise<PollAnswer<BacklogListing>> {
  try {
    const listing = await read(query, AbortSignal.timeout(BACKLOG_TIMEOUT_MS));

    return { state: "fresh", payload: listing, etag: null, pollAfterSeconds: null };
  } catch (error) {
    // Whatever was not an answer from the service — a `TypeError` for a dropped connection, a
    // `TimeoutError` for {@link BACKLOG_TIMEOUT_MS} — says the same thing to a reader looking
    // at a table, and the distinction between them is one only a log can act on.
    if (!isApiError(error)) {
      return { state: "failed", reason: UNREACHABLE_BACKLOG, pollAfterSeconds: null };
    }

    if (error.isUnauthenticated) return { state: "gone" };

    // The service's own sentence: every message in the contract's envelope is written for a
    // person and names nothing internal (`app/api/errors.ts`).
    return { state: "failed", reason: error.message, pollAfterSeconds: null };
  }
}
