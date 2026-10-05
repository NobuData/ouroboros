import "server-only";

/**
 * The inbox's side column, read for the `/inbox` page's poll (BO.4,
 * [#469](https://github.com/NobuData/ouroboros/issues/469)) — `GET /api/v1/inbox/channels` (BN.3,
 * #463) and `GET /api/v1/inbox/policies` (BN.4, #464) through the caller's session, with the poll
 * family's deadline and its three answers (`app/api/poll-read.ts`).
 */

import { type InboxSide, inbox } from "@/app/api/inbox";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_SIDE } from "@/app/inbox/side-view";
import type { PollAnswer } from "@/app/poll";

/** The code this hop reports under when the service could not be read. */
export const INBOX_SIDE_UNAVAILABLE_CODE = "inbox_side_unavailable";

/**
 * One read of the side column.
 *
 * @param read How to read it. Defaults to the service through the request's session.
 * @returns The poll's answer.
 */
export async function readInboxSide(
  read: (signal: AbortSignal) => Promise<InboxSide> = (signal) => inbox.side(anonymousApi(), signal),
): Promise<PollAnswer<InboxSide>> {
  return readForPoll(read, UNREACHABLE_SIDE);
}
