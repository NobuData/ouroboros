import "server-only";

/**
 * The `/inbox` frame's first paint (BO.1, [#466](https://github.com/NobuData/ouroboros/issues/466)):
 * the queue, read once on the server so the head is there before any poll answers — and today's
 * resolved list beside it (BO.3, [#468](https://github.com/NobuData/ouroboros/issues/468)), so
 * *Resolved today · 5* is not a count that arrives late. The side column's two cards and the
 * reader's notification preferences come with them (BO.4,
 * [#469](https://github.com/NobuData/ouroboros/issues/469)): a channel's ✓ and a rule's row are
 * claims, and a claim that pops in a second later reads as one that was not true a second ago.
 * The week's stat card is read with them (BO.5, [#470](https://github.com/NobuData/ouroboros/issues/470))
 * for the same reason: its three figures are claims too.
 */

import {
  type InboxQueue,
  type InboxResolved,
  type InboxSide,
  type InboxStats,
  type NotificationPreferences,
  inbox,
} from "@/app/api/inbox";
import { type Reading, attempt } from "@/app/api/reading";

/** Everything the first paint is drawn from. */
export interface InboxReadings {
  /** The queue, or why it could not be read. */
  readonly queue: Reading<InboxQueue>;
  /** Today's resolved decisions, or why they could not be read. */
  readonly resolved: Reading<InboxResolved>;
  /** The channels' truth and the policy card, or why they could not be read. */
  readonly side: Reading<InboxSide>;
  /** This week's stat card, or why it could not be read. */
  readonly stats: Reading<InboxStats>;
  /** The reader's notification preferences, or why they could not be read. */
  readonly notifications: Reading<NotificationPreferences>;
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
  const [queue, resolved, side, stats, notifications] = await Promise.all([
    attempt(() => inbox.queue()),
    attempt(() => inbox.resolved()),
    attempt(() => inbox.side()),
    attempt(() => inbox.stats()),
    attempt(() => inbox.notifications()),
  ]);

  return { queue, resolved, side, stats, notifications, readAt: now() };
}
