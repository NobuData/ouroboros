/**
 * The `/inbox` frame's poll (BO.1, [#466](https://github.com/NobuData/ouroboros/issues/466)) — the
 * I.8 poll family over `GET /api/inbox`, which forwards `GET /api/v1/inbox` (BN.4, #464).
 *
 * One read keeps the head, the queue rows and the snoozed group fresh without a reload; the sidebar
 * badge has its own poll of the feed (`app/shell/inbox-poll.ts`) and agrees with this one because
 * both count the same asking items.
 */

import type { InboxQueue } from "@/app/api/inbox";
import { type Poll, type PollOptions, type PollReader, createPoll, requestPayload } from "@/app/poll";

/** Where the browser asks — **this origin**, not `ouroboros-rest`. */
export const INBOX_QUEUE_ENDPOINT = "/api/inbox";

/** What is said when something answered and this client could not read it as the queue. */
export const UNREADABLE_QUEUE = "The inbox could not be read.";

/** What is said when nothing answered at all — a dropped connection, a timeout. */
export const UNREACHABLE_QUEUE = "The inbox could not be reached.";

/** One read of the queue, as the loop needs it. Replaced wholesale in tests. */
export type QueueReader = PollReader<InboxQueue>;

/** How to build the poll. Everything is optional; production supplies none of it. */
export interface QueuePollOptions extends PollOptions {
  /** How to make one read. Defaults to {@link requestQueue}. */
  read?: QueueReader;
}

/**
 * Whether a payload is shaped like the queue — enough to draw the head and the rows.
 *
 * @param value What arrived.
 * @returns `true` for a queue.
 */
export function isInboxQueue(value: unknown): value is InboxQueue {
  if (typeof value !== "object" || value === null) return false;

  const { head, items, snoozed } = value as Partial<Record<keyof InboxQueue, unknown>>;

  if (typeof head !== "object" || head === null || !Array.isArray(items) || !Array.isArray(snoozed)) {
    return false;
  }

  const { count, sentence } = head as Record<string, unknown>;

  return typeof count === "number" && Number.isInteger(count) && count >= 0 && typeof sentence === "string";
}

/**
 * One read of the queue on this origin.
 *
 * @param etag The last answer's entity tag, or `null`.
 * @returns The poll's answer.
 */
export function requestQueue(etag: string | null) {
  return requestPayload(INBOX_QUEUE_ENDPOINT, etag, isInboxQueue, {
    unreachable: UNREACHABLE_QUEUE,
    unreadable: UNREADABLE_QUEUE,
  });
}

/**
 * Build the frame's poll.
 *
 * @param options A stubbed reader, a fake clock — the test seams.
 * @returns The poll, not yet started.
 */
export function createQueuePoll(options: QueuePollOptions = {}): Poll<InboxQueue> {
  return createPoll(options.read ?? requestQueue, options);
}
