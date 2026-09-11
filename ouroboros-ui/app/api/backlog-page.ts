import "server-only";

/**
 * One page of the backlog, read on behalf of the table's poll
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)) — and, since
 * [#120](https://github.com/NobuData/ouroboros/issues/120), the sync's status beside it.
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
 * ### Two reads, one answer
 *
 * The table's guidance states — *no token*, *no enabled repository*, *first sync running* —
 * and the sync banner over its rows are decided from M.4's status, and a status read once at
 * the first paint would be a banner that never clears: a rate limit that reset, a token that
 * was connected, a first sync that finished would each stay on screen until a reload. So the
 * status rides the same poll the rows do, read beside the listing in one ask, and the two
 * cannot disagree about the moment they describe. The status failing on its own is a reason
 * the page carries rather than a failed page: the rows are still the rows, and what could
 * not be read is said once, by the banner, with the way to ask again.
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

import { type BacklogListing, type BacklogQuery, type SyncStatus, backlog } from "@/app/api/backlog";
import { isApiError } from "@/app/api/errors";
import { POLL_READ_TIMEOUT_MS, readForPoll } from "@/app/api/poll-read";
import type { Reading } from "@/app/api/reading";
import { anonymousApi } from "@/app/api/server";
import { type BacklogPage, UNREACHABLE_BACKLOG } from "@/app/issues/backlog-poll";
import type { PollAnswer } from "@/app/poll";

/**
 * How long to wait for the page before giving up, in milliseconds — the poll readers' one
 * deadline, kept under its old name for the suite that holds it inside the cadence.
 */
export const BACKLOG_TIMEOUT_MS = POLL_READ_TIMEOUT_MS;

/** The two reads one page is composed of — seams, so a test can drive each alone. */
export interface BacklogPageReads {
  /** One page of the listing, for the query, before the deadline. */
  readonly listing: (query: BacklogQuery, signal: AbortSignal) => Promise<BacklogListing>;
  /** The sync's status, before the same deadline. */
  readonly status: (signal: AbortSignal) => Promise<SyncStatus>;
}

/**
 * The reads production makes: the typed client over the session's cookies, one client for
 * both so the two calls travel with the same session.
 *
 * @returns The reads.
 */
function productionReads(): BacklogPageReads {
  const client = anonymousApi();

  return {
    listing: (query, signal) => backlog.list(query, client, signal),
    status: (signal) => backlog.status(client, signal),
  };
}

/**
 * The status read, kept as a value when the service refused it.
 *
 * `app/api/reading.ts`'s `attempt`, with one more thing let through: a `401` keeps travelling
 * so that `readForPoll` answers *gone* for the page, since a session that has ended is not a
 * status that could not be read.
 *
 * @param read The status read, already given its deadline.
 * @returns The status, or the service's reason for refusing it.
 * @throws Whatever is not a refusal — a dropped connection, the deadline, the session ending.
 */
async function statusReading(read: () => Promise<SyncStatus>): Promise<Reading<SyncStatus>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    if (!isApiError(error) || error.isUnauthenticated) throw error;
    return { ok: false, reason: error.message };
  }
}

/**
 * Read one page of the backlog, and the sync's status beside it, for a poll.
 *
 * @param query The page's query — the filter bar's controls and the page as `limit`/`offset`,
 *   as `app/issues/paging.ts` spells them.
 * @param reads How to make the two reads. Defaults to the typed client over the session's
 *   cookies; tests pass stubs.
 * @returns The answer — the page, *gone* for a session that has ended, or a sentence about
 *   why not. The listing failing fails the page, since there is nothing to draw without it;
 *   the status failing is a reason inside a page that still has its rows.
 */
export async function readBacklogPage(
  query: BacklogQuery,
  reads: BacklogPageReads = productionReads(),
): Promise<PollAnswer<BacklogPage>> {
  return readForPoll(async (signal) => {
    const [listing, sync] = await Promise.all([
      reads.listing(query, signal),
      statusReading(() => reads.status(signal)),
    ]);

    return { listing, sync };
  }, UNREACHABLE_BACKLOG);
}
