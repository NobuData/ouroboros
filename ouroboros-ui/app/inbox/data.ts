import "server-only";

/**
 * The `/inbox` frame's first paint (BO.1, [#466](https://github.com/NobuData/ouroboros/issues/466)):
 * the queue, read once on the server so the head is there before any poll answers — and today's
 * resolved list beside it (BO.3, [#468](https://github.com/NobuData/ouroboros/issues/468)), so
 * *Resolved today · 5* is not a count that arrives late.
 */

import { type InboxQueue, type InboxResolved, inbox } from "@/app/api/inbox";
import { type Reading, attempt } from "@/app/api/reading";

/** Everything the first paint is drawn from. */
export interface InboxReadings {
  /** The queue, or why it could not be read. */
  readonly queue: Reading<InboxQueue>;
  /** Today's resolved decisions, or why they could not be read. */
  readonly resolved: Reading<InboxResolved>;
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
  const [queue, resolved] = await Promise.all([attempt(() => inbox.queue()), attempt(() => inbox.resolved())]);

  return { queue, resolved, readAt: now() };
}
