import "server-only";

/**
 * The server half of the `/inbox` poll (BO.1, [#466](https://github.com/NobuData/ouroboros/issues/466)):
 * one read of `GET /api/v1/inbox` with the request's own session, answered in the poll family's
 * shape.
 */

import { type InboxQueue, inbox } from "@/app/api/inbox";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_QUEUE } from "@/app/inbox/queue-poll";
import type { PollAnswer } from "@/app/poll";

/** The code a failed read is reported under — this hop's own, not the service's. */
export const INBOX_QUEUE_UNAVAILABLE_CODE = "inbox_queue_unavailable";

/**
 * Read the queue for one poll.
 *
 * @param read How to read — a test seam; the service through the request's session by default.
 * @returns The poll's answer.
 */
export async function readInboxQueue(
  read: (signal: AbortSignal) => Promise<InboxQueue> = (signal) => inbox.queue(anonymousApi(), signal),
): Promise<PollAnswer<InboxQueue>> {
  return readForPoll(read, UNREACHABLE_QUEUE);
}
