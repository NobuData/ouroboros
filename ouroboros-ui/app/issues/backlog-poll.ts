/**
 * The backlog table's poll — `app/poll.ts`'s loop over one page of the listing
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)).
 *
 * The ticket's sharpest line is *"`estimating…` must actually become `sized` when the pipeline
 * finishes, not on a timer"*, and this is how: the browser asks `app/api/backlog/route.ts` for
 * the page it is showing, on the DASH-I.8 cadence ([#87](https://github.com/NobuData/ouroboros/issues/87)),
 * and the rows it draws are the last answer. The loop — the interval, the hidden tab, the
 * sequence check that keeps an overtaken answer out of the store — is the generic one; what is
 * here is the backlog's reader, the guard that decides whether what answered is a listing at
 * all, and the two sentences a failed ask carries.
 *
 * **Framework-free**, so the reader is a unit test against a stubbed `fetch`;
 * `app/issues/use-backlog-poll.ts` is where it meets React.
 */

import type { BacklogListing } from "@/app/api/backlog";
import {
  type Poll,
  type PollOptions,
  type PollReader,
  createPoll,
  requestPayload,
} from "@/app/poll";

import type { BacklogFilter } from "./filter";
import { pageSearch } from "./paging";

/**
 * Where the browser asks — **this origin**, not `ouroboros-rest`, for the reason
 * `app/dashboard/summary.ts` gives for its own endpoint. The query string is the view's own
 * (`app/issues/paging.ts`), so the handler parses the same address the page was rendered from.
 */
export const BACKLOG_ENDPOINT = "/api/backlog";

/** What is said when something answered and this client could not read it as a listing. */
export const UNREADABLE_BACKLOG = "The backlog could not be read.";

/** What is said when nothing answered at all — a dropped connection, a timeout. */
export const UNREACHABLE_BACKLOG = "The backlog could not be reached.";

/** One read of the listing, as the loop needs it. Replaced wholesale in tests. */
export type BacklogReader = PollReader<BacklogListing>;

/** How to build the table's poll. Everything is optional; production supplies none of it. */
export interface BacklogPollOptions extends PollOptions {
  /** How to make one read. Defaults to {@link requestBacklog} over the poll's address. */
  read?: BacklogReader;
}

/**
 * The address the table polls for one page of a filtered view.
 *
 * @param filter The filter the address carries.
 * @param page The page.
 * @returns {@link BACKLOG_ENDPOINT} followed by the view's own query string.
 */
export function backlogUrl(filter: BacklogFilter, page: number): string {
  return `${BACKLOG_ENDPOINT}${pageSearch(filter, page)}`;
}

/**
 * Whether a parsed body is a page of the backlog.
 *
 * Structural rather than exhaustive, the way `isDashboardSummary` is: the table reaches for
 * `items`, the footer for `total` and `offset`, the freshness tag for `meta`, and a body
 * carrying those is the listing for every purpose this screen has. Checking it at all is the
 * boundary between *the contract's type* and *whatever answered on that URL*.
 *
 * @param value A parsed response body.
 * @returns `true` when it can be read as a {@link BacklogListing}.
 */
export function isBacklogListing(value: unknown): value is BacklogListing {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<BacklogListing>;

  return (
    Array.isArray(candidate.items) &&
    typeof candidate.total === "number" &&
    typeof candidate.offset === "number" &&
    typeof candidate.meta === "object" &&
    candidate.meta !== null
  );
}

/**
 * A reader of one address, from the browser.
 *
 * @param url Where to ask — {@link backlogUrl}'s answer.
 * @returns The reader. **It does not throw**, for the reason `requestPayload` gives.
 */
export function requestBacklog(url: string): BacklogReader {
  return (etag) =>
    requestPayload(url, etag, isBacklogListing, {
      unreachable: UNREACHABLE_BACKLOG,
      unreadable: UNREADABLE_BACKLOG,
    });
}

/**
 * Build the table's loop over one address.
 *
 * @param url Where to ask — {@link backlogUrl}'s answer. Ignored when `options.read` is given.
 * @param options Test seams; production passes none.
 * @returns The poll. It is inert until `start` is called.
 */
export function createBacklogPoll(
  url: string,
  options: BacklogPollOptions = {},
): Poll<BacklogListing> {
  return createPoll(options.read ?? requestBacklog(url), options);
}
