import "server-only";

/**
 * The `/inbox` frame's first paint (BO.1, [#466](https://github.com/NobuData/ouroboros/issues/466)):
 * the queue, read once on the server so the head is there before any poll answers.
 */

import { type InboxQueue, inbox } from "@/app/api/inbox";
import { type Reading, attempt } from "@/app/api/reading";

/** Everything the first paint is drawn from. */
export interface InboxReadings {
  /** The queue, or why it could not be read. */
  readonly queue: Reading<InboxQueue>;
  /** When the read was made, epoch milliseconds — the same instant on the hydration pass. */
  readonly readAt: number;
}

/**
 * Read the frame.
 *
 * @param now The clock — a test seam.
 * @returns The readings.
 */
export async function readInbox(now: () => number = Date.now): Promise<InboxReadings> {
  return { queue: await attempt(() => inbox.queue()), readAt: now() };
}
