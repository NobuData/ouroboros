import "server-only";

/**
 * The insights page, read on behalf of the screen's poll
 * (BK.2, [#443](https://github.com/NobuData/ouroboros/issues/443)).
 *
 * The server's half of the poll, the seam `app/api/farm-page.ts` is for the farm: it answers in
 * `app/poll.ts`'s four cases so that `app/api/insights/route.ts` can turn the answer into HTTP
 * and `app/insights/insights-poll.ts` can read it back out. BJ.2's read answers no `ETag` and no
 * cadence hint, so the translation is `app/api/poll-read.ts`'s alone.
 *
 * The client is `anonymousApi()`, for the reason `app/api/backlog-page.ts` gives: a poll is not a
 * render, and a `401` is an answer (*gone*) rather than a redirect.
 */

import { type InsightsPage, type InsightsRange, insights } from "@/app/api/insights";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_INSIGHTS } from "@/app/insights/insights-poll";
import type { PollAnswer } from "@/app/poll";

/** The code a failed read is reported under — this hop's own, not the service's. */
export const INSIGHTS_UNAVAILABLE_CODE = "insights_unavailable";

/**
 * Read the insights page for a poll.
 *
 * @param range The range the poll is for.
 * @param read How to make the read, given the range and the deadline. Defaults to the typed
 *   client over the session's cookies; tests pass a stub.
 * @returns The answer — the page, *gone* for a session that has ended, or a sentence about why
 *   not. **It does not throw**, for the reason `readForPoll` gives.
 */
export async function readInsightsPage(
  range: InsightsRange,
  read: (range: InsightsRange, signal: AbortSignal) => Promise<InsightsPage> = (asked, signal) =>
    insights.page(asked, anonymousApi(), signal),
): Promise<PollAnswer<InsightsPage>> {
  return readForPoll((signal) => read(range, signal), UNREACHABLE_INSIGHTS);
}
