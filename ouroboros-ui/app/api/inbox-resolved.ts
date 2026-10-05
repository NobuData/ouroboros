import "server-only";

/**
 * The resolved list, read for the `/inbox` page's poll (BO.3,
 * [#468](https://github.com/NobuData/ouroboros/issues/468)) — `GET /api/v1/inbox/resolved` (BN.4,
 * #464) through the caller's session, with the poll family's deadline and its three answers
 * (`app/api/poll-read.ts`).
 */

import { type InboxResolved, inbox } from "@/app/api/inbox";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_RESOLVED, parseDay } from "@/app/inbox/resolved-view";
import type { PollAnswer } from "@/app/poll";

/** The code this hop reports under when the service could not be read. */
export const INBOX_RESOLVED_UNAVAILABLE_CODE = "inbox_resolved_unavailable";

/**
 * One read of a day's resolutions.
 *
 * @param day The day asked for, as it arrived in the query — anything that is not a
 *   `YYYY-MM-DD` date reads as *today*, so a hand-typed address cannot make the service refuse.
 * @param read How to read a day. Defaults to the service through the request's session.
 * @returns The poll's answer.
 */
export async function readInboxResolved(
  day: string | null | undefined,
  read: (day: string | undefined, signal: AbortSignal) => Promise<InboxResolved> = (asked, signal) =>
    inbox.resolved(asked, anonymousApi(), signal),
): Promise<PollAnswer<InboxResolved>> {
  const asked = parseDay(day) ?? undefined;

  return readForPoll((signal) => read(asked, signal), UNREACHABLE_RESOLVED);
}
