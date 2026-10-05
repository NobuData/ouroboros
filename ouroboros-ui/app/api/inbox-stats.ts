import "server-only";

/**
 * The week's stat card, read for the `/inbox` page's poll (BO.5,
 * [#470](https://github.com/NobuData/ouroboros/issues/470)) — `GET /api/v1/inbox/stats` (BN.4,
 * #464) through the caller's session, with the poll family's deadline and its three answers
 * (`app/api/poll-read.ts`).
 */

import { type InboxStats, inbox } from "@/app/api/inbox";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_STATS } from "@/app/inbox/stats-view";
import type { PollAnswer } from "@/app/poll";

/** The code this hop reports under when the service could not be read. */
export const INBOX_STATS_UNAVAILABLE_CODE = "inbox_stats_unavailable";

/**
 * One read of the stat card.
 *
 * @param read How to read it. Defaults to the service through the request's session.
 * @returns The poll's answer.
 */
export async function readInboxStats(
  read: (signal: AbortSignal) => Promise<InboxStats> = (signal) => inbox.stats(anonymousApi(), signal),
): Promise<PollAnswer<InboxStats>> {
  return readForPoll(read, UNREACHABLE_STATS);
}
