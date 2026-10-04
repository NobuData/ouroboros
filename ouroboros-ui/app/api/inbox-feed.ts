import "server-only";

/**
 * The inbox feed, read for the badge's poll (#461) — `app/api/insights-page.ts`'s shape: one read
 * through the session's own client, translated into the poll's four cases by `poll-read.ts`.
 */

import { type InboxFeed, inbox } from "@/app/api/inbox";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_INBOX } from "@/app/shell/inbox-poll";
import type { PollAnswer } from "@/app/poll";

/** The code a failed read is reported under — this hop's own, not the service's. */
export const INBOX_UNAVAILABLE_CODE = "inbox_unavailable";

/**
 * Read the feed for one poll.
 *
 * @param read How to make the read, given the poll's deadline. Defaults to the session's client
 *   that reads a `401` as *gone* rather than redirecting.
 * @returns The poll's answer — never throws.
 */
export async function readInboxFeed(
  read: (signal: AbortSignal) => Promise<InboxFeed> = (signal) => inbox.feed(anonymousApi(), signal),
): Promise<PollAnswer<InboxFeed>> {
  return readForPoll(read, UNREACHABLE_INBOX);
}
