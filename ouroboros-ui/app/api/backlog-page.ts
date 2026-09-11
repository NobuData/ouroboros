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
 * Every outcome is one of the four answers — `app/api/poll-read.ts` is the translation, shared
 * with the detail panel's reader since [#119](https://github.com/NobuData/ouroboros/issues/119)
 * — because the caller is a route handler answering a poll and there is no error boundary
 * behind it that could render anything better than the poll itself can.
 */

import { type BacklogListing, type BacklogQuery, backlog } from "@/app/api/backlog";
import { POLL_READ_TIMEOUT_MS, readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_BACKLOG } from "@/app/issues/backlog-poll";
import type { PollAnswer } from "@/app/poll";

/**
 * How long to wait for the listing before giving up, in milliseconds — the poll readers' one
 * deadline, kept under its old name for the suite that holds it inside the cadence.
 */
export const BACKLOG_TIMEOUT_MS = POLL_READ_TIMEOUT_MS;

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
  return readForPoll((signal) => read(query, signal), UNREACHABLE_BACKLOG);
}
