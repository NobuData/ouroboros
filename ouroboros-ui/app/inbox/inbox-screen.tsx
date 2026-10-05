"use client";

import { useCallback, useEffect, useState } from "react";

import type { InboxQueue } from "@/app/api/inbox";
import { clockTime } from "@/app/dashboard/view";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { INBOX_BADGE_SOURCE } from "@/app/shell/nav-modules";
import { setNavBadge } from "@/app/shell/nav-registry";
import { RetryBanner } from "@/app/ui";
import type { PollSnapshot } from "@/app/poll";

import type { InboxReadings } from "./data";
import { InboxHead } from "./inbox-head";
import { QueueList } from "./queue-list";
import { INBOX_QUEUE_ENDPOINT, type QueuePollOptions, createQueuePoll } from "./queue-poll";

import "./inbox.css";

/** What the banner says over a stale queue. */
export const STALE_HEADLINE = "The inbox could not be refreshed.";

/**
 * The queue on screen: the poll's latest, else the server's first read.
 *
 * @param initial The first paint's reading.
 * @param snapshot The poll's state.
 * @returns The queue (or `null`) and why the latest attempt failed (or `null`).
 */
export function queueReading(
  initial: InboxReadings["queue"],
  snapshot: PollSnapshot<InboxQueue>,
): { queue: InboxQueue | null; failure: string | null } {
  if (snapshot.data !== null) return { queue: snapshot.data, failure: snapshot.error };

  return initial.ok
    ? { queue: initial.value, failure: snapshot.error }
    : { queue: null, failure: snapshot.error ?? initial.reason };
}

/**
 * How many items are asking, once the cards this reader just settled are taken out.
 *
 * An answer or a snooze made on a card is true the moment the service says so, but the queue on
 * screen is the read from before it. Until a newer read arrives, the items settled against *this*
 * read are subtracted, so the **Needs You** badge drops with the press rather than with the next
 * poll; a newer read is the service's own count and is trusted as it stands.
 *
 * @param queue The queue on screen, or `null`.
 * @param settled Each item settled here, with the `asOf` of the read it was settled against.
 * @returns The count, or `undefined` when no queue was read.
 */
export function askingCount(queue: InboxQueue | null, settled: ReadonlyMap<string, string>): number | undefined {
  if (queue === null) return undefined;

  const answered = queue.items.filter((item) => settled.get(item.id) === queue.asOf).length;

  return Math.max(0, queue.head.count - answered);
}

/**
 * The `/inbox` frame (BO.1, [#466](https://github.com/NobuData/ouroboros/issues/466), mockup 16):
 * the head and the queue in the shell's content pane, kept fresh by the I.8 poll family without a
 * reload. Every answer is also published to the sidebar's **Needs You** badge, so a snooze moves
 * the badge the moment it lands rather than at the feed's next tick; the feed's own poll keeps
 * agreeing because both count the same asking items. A decision card that settles (BO.2,
 * [#467](https://github.com/NobuData/ouroboros/issues/467)) drops the badge at once and asks for
 * a fresh read.
 *
 * @param props.readings What the route read for the first paint.
 * @param props.poll Test seams for the poll.
 * @param props.clock How an instant is printed — the reader's own clock by default.
 * @param props.newKey Mints a press's idempotency key — a test seam.
 * @returns The screen.
 */
export function InboxScreen({
  readings,
  poll,
  clock = clockTime,
  newKey,
}: Readonly<{
  readings: InboxReadings;
  poll?: QueuePollOptions;
  clock?: (atMs: number) => string;
  newKey?: () => string;
}>) {
  const { snapshot, refresh } = useKeyedPoll(INBOX_QUEUE_ENDPOINT, () => createQueuePoll(poll));
  const { queue, failure } = queueReading(readings.queue, snapshot);
  const [retrying, setRetrying] = useState<PollSnapshot<InboxQueue> | null>(null);
  const [settled, setSettled] = useState<ReadonlyMap<string, string>>(new Map());

  const retry = useCallback(() => {
    if (retrying === snapshot) return;

    setRetrying(snapshot);
    refresh();
  }, [retrying, snapshot, refresh]);

  const count = askingCount(queue, settled);
  const asOf = queue?.asOf;

  useEffect(() => {
    if (count !== undefined) setNavBadge(INBOX_BADGE_SOURCE, count);
  }, [count]);

  /** A card settled here: count it out against the read on screen, and ask for a fresh one. */
  function onSettled(itemId: string): void {
    if (asOf !== undefined) setSettled((before) => new Map(before).set(itemId, asOf));

    refresh();
  }

  return (
    <main className="inbox">
      {failure !== null && (
        <RetryBanner
          className="inbox__stale"
          headline={STALE_HEADLINE}
          onRetry={retry}
          reason={failure}
          retrying={retrying === snapshot}
        />
      )}
      <InboxHead clock={clock} onSnoozed={() => refresh()} queue={queue} />
      {queue !== null && (
        <QueueList
          asOf={queue.asOf}
          clock={clock}
          items={queue.items}
          newKey={newKey}
          onSettled={onSettled}
          snoozed={queue.snoozed}
        />
      )}
    </main>
  );
}
