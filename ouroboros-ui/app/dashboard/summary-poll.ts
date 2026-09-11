/**
 * The dashboard's poll — `app/poll.ts`'s loop over one reader
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)).
 *
 * The loop itself — the interval, the hidden tab, the tag, the sequence check that keeps an
 * overtaken answer out of the store — is `app/poll.ts`'s since
 * [#117](https://github.com/NobuData/ouroboros/issues/117) made it generic, and that file
 * is where the contract's clauses are argued. What is here is the dashboard's reader, one
 * conditional `GET` of {@link SUMMARY_ENDPOINT}, and the names the dashboard's store and
 * suites already use for the loop's types.
 *
 * **Framework-free**, as before: `app/dashboard/summary-store.tsx` is the four lines where
 * it meets React.
 */

import {
  type DashboardSummary,
  SUMMARY_ENDPOINT,
  type SummaryAnswer,
  UNREACHABLE_SUMMARY,
  UNREADABLE_SUMMARY,
  isDashboardSummary,
} from "./summary";
import {
  EMPTY_POLL_SNAPSHOT,
  type Poll,
  type PollOptions,
  type PollSnapshot,
  createPoll,
  requestPayload,
} from "@/app/poll";

export { SESSION_ENDED } from "@/app/poll";

/** What every consumer of the poll reads — see `PollSnapshot` for what each field means. */
export type SummarySnapshot = PollSnapshot<DashboardSummary>;

/** Nothing read yet: what the server renders, and what the browser holds until it asks. */
export const EMPTY_SNAPSHOT: SummarySnapshot = EMPTY_POLL_SNAPSHOT;

/** One conditional read, as the loop needs it. Replaced wholesale in tests. */
export type SummaryReader = (etag: string | null) => Promise<SummaryAnswer>;

/** The loop, as its consumers see it. */
export type SummaryPoll = Poll<DashboardSummary>;

/** How to build a poll. Everything is optional; production supplies none of it. */
export interface SummaryPollOptions extends PollOptions {
  /** How to make one read. Defaults to {@link requestSummary}. */
  read?: SummaryReader;
}

/**
 * Read the summary once, from the browser.
 *
 * The request goes to {@link SUMMARY_ENDPOINT} on this origin — see `app/api/dashboard/route.ts`
 * for why the service itself is not reachable from here. **This does not throw**, for the
 * reason `requestPayload` gives.
 *
 * @param etag The tag the caller holds, echoed as `If-None-Match`, or `null` to ask
 *   unconditionally.
 * @returns The answer.
 */
export function requestSummary(etag: string | null): Promise<SummaryAnswer> {
  return requestPayload(SUMMARY_ENDPOINT, etag, isDashboardSummary, {
    unreachable: UNREACHABLE_SUMMARY,
    unreadable: UNREADABLE_SUMMARY,
  });
}

/**
 * Build the dashboard's loop.
 *
 * @param options Test seams; production passes none.
 * @returns The poll. It is inert until `start` is called.
 */
export function createSummaryPoll(options: SummaryPollOptions = {}): SummaryPoll {
  return createPoll(options.read ?? requestSummary, options);
}
