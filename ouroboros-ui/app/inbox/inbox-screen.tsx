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
 * The `/inbox` frame (BO.1, [#466](https://github.com/NobuData/ouroboros/issues/466), mockup 16):
 * the head and the queue in the shell's content pane, kept fresh by the I.8 poll family without a
 * reload. Every answer is also published to the sidebar's **Needs You** badge, so a snooze moves
 * the badge the moment it lands rather than at the feed's next tick; the feed's own poll keeps
 * agreeing because both count the same asking items.
 *
 * @param props.readings What the route read for the first paint.
 * @param props.poll Test seams for the poll.
 * @param props.clock How an instant is printed — the reader's own clock by default.
 * @returns The screen.
 */
export function InboxScreen({
  readings,
  poll,
  clock = clockTime,
}: Readonly<{ readings: InboxReadings; poll?: QueuePollOptions; clock?: (atMs: number) => string }>) {
  const { snapshot, refresh } = useKeyedPoll(INBOX_QUEUE_ENDPOINT, () => createQueuePoll(poll));
  const { queue, failure } = queueReading(readings.queue, snapshot);
  const [retrying, setRetrying] = useState<PollSnapshot<InboxQueue> | null>(null);
  const count = queue?.head.count;

  useEffect(() => {
    if (count !== undefined) setNavBadge(INBOX_BADGE_SOURCE, count);
  }, [count]);

  const retry = useCallback(() => {
    if (retrying === snapshot) return;

    setRetrying(snapshot);
    refresh();
  }, [retrying, snapshot, refresh]);

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
      {queue !== null && <QueueList clock={clock} items={queue.items} snoozed={queue.snoozed} />}
    </main>
  );
}
