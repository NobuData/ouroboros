"use client";

import { useCallback, useEffect, useState } from "react";

import type { InboxQueue, InboxResolved, InboxSide, NotificationPreferences } from "@/app/api/inbox";
import { clockTime } from "@/app/dashboard/view";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { INBOX_BADGE_SOURCE } from "@/app/shell/nav-modules";
import { setNavBadge } from "@/app/shell/nav-registry";
import { RetryBanner } from "@/app/ui";
import type { PollSnapshot } from "@/app/poll";

import { ChannelsCard } from "./channels-card";
import type { InboxReadings } from "./data";
import { InboxHead } from "./inbox-head";
import { PolicyCard } from "./policy-card";
import { QueueList } from "./queue-list";
import { INBOX_QUEUE_ENDPOINT, type QueuePollOptions, createQueuePoll } from "./queue-poll";
import { setResolvedCollapsed, useResolvedCollapsed } from "./resolved-collapse";
import { ResolvedList } from "./resolved-list";
import { type ResolvedPollOptions, createResolvedPoll, resolvedEndpoint } from "./resolved-poll";
import { INBOX_SIDE_ENDPOINT, type SidePollOptions, createSidePoll } from "./side-poll";
import { SIDE_LABEL } from "./side-view";
import { ZeroCard } from "./zero-card";

import "./inbox.css";

/** Whose fold of the resolved list it is when the page was handed no reader. */
const ANONYMOUS_READER = "anonymous";

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
 * The resolved day on screen: the poll's latest for the day asked, else — for today only — the
 * server's first read.
 *
 * @param initial The first paint's reading of today.
 * @param snapshot The poll's state for the day asked.
 * @param day The day asked for, or `null` for today.
 * @returns The day (or `null` while unread) and why the latest attempt failed (or `null`).
 */
export function resolvedReading(
  initial: InboxReadings["resolved"],
  snapshot: PollSnapshot<InboxResolved>,
  day: string | null,
): { resolved: InboxResolved | null; failure: string | null } {
  if (snapshot.data !== null) return { resolved: snapshot.data, failure: snapshot.error };

  // The first paint read today; another day has nothing until its own poll answers.
  if (day !== null) return { resolved: null, failure: snapshot.error };

  return initial.ok
    ? { resolved: initial.value, failure: snapshot.error }
    : { resolved: null, failure: snapshot.error ?? initial.reason };
}

/**
 * The side column on screen: the poll's latest, else the server's first read.
 *
 * @param initial The first paint's reading.
 * @param snapshot The poll's state.
 * @returns The two cards' payload (or `null`) and why the latest attempt failed (or `null`).
 */
export function sideReading(
  initial: InboxReadings["side"],
  snapshot: PollSnapshot<InboxSide>,
): { side: InboxSide | null; failure: string | null } {
  if (snapshot.data !== null) return { side: snapshot.data, failure: snapshot.error };

  return initial.ok
    ? { side: initial.value, failure: snapshot.error }
    : { side: null, failure: snapshot.error ?? initial.reason };
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
 * Under the queue (BO.3, [#468](https://github.com/NobuData/ouroboros/issues/468)): the **Inbox
 * zero** card, drawn only when nothing is asking — never beside a live item, which is where the
 * page deliberately parts from the mockup's demonstration layout — and the **Resolved** list for
 * the day on screen, on a poll of its own that a settling card also refreshes.
 *
 * Beside them (BO.4, [#469](https://github.com/NobuData/ouroboros/issues/469)): **Answer From
 * Anywhere** and **What Needs A Human**, on one poll of their own, so a channel that becomes
 * available, a policy that is removed and a dry-run that is flipped all reach the page without a
 * reload. The reader's notification preferences are held here, because three things show them —
 * the email row's digest and the sheet from either of its two entry points — and a save in one
 * must be what the others say. They are one person's in one workspace, so a fresh server read
 * (the workspace switch) replaces them.
 *
 * @param props.readings What the route read for the first paint.
 * @param props.readerId The reader's `user.id` — whose fold of the resolved list this is. A
 *   page that cannot name its reader shares one anonymous fold rather than a heading that will
 *   not fold.
 * @param props.poll Test seams for the queue's poll.
 * @param props.resolvedPoll Test seams for the resolved list's poll.
 * @param props.sidePoll Test seams for the side column's poll.
 * @param props.clock How an instant is printed — the reader's own clock by default.
 * @param props.newKey Mints a press's idempotency key — a test seam.
 * @returns The screen.
 */
export function InboxScreen({
  readings,
  readerId = ANONYMOUS_READER,
  poll,
  resolvedPoll,
  sidePoll,
  clock = clockTime,
  newKey,
}: Readonly<{
  readings: InboxReadings;
  readerId?: string;
  poll?: QueuePollOptions;
  resolvedPoll?: ResolvedPollOptions;
  sidePoll?: SidePollOptions;
  clock?: (atMs: number) => string;
  newKey?: () => string;
}>) {
  const { snapshot, refresh } = useKeyedPoll(INBOX_QUEUE_ENDPOINT, () => createQueuePoll(poll));
  const { queue, failure } = queueReading(readings.queue, snapshot);
  const [day, setDay] = useState<string | null>(null);
  const history = useKeyedPoll(resolvedEndpoint(day), (endpoint) => createResolvedPoll(endpoint, resolvedPoll));
  const resolved = resolvedReading(readings.resolved, history.snapshot, day);
  const collapsed = useResolvedCollapsed(readerId);
  const beside = useKeyedPoll(INBOX_SIDE_ENDPOINT, () => createSidePoll(sidePoll));
  const side = sideReading(readings.side, beside.snapshot);
  const [held, setHeld] = useState({ readFrom: readings.notifications, preferences: readings.notifications });

  // What is held was learned on top of one server read. A new read is another answer to *whose
  // preferences, in which workspace* — the workspace switch re-renders the route — so what was
  // held over the old one no longer applies, and the old workspace's digest is never drawn
  // under the new one.
  const preferences = held.readFrom === readings.notifications ? held.preferences : readings.notifications;
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

  /**
   * A card settled here: count it out against the read on screen, and ask for a fresh queue and
   * a fresh resolved list — an answer made a moment ago belongs in today's history at once.
   */
  function onSettled(itemId: string): void {
    if (asOf !== undefined) setSettled((before) => new Map(before).set(itemId, asOf));

    refresh();
    history.refresh();
  }

  /** The preferences were read or saved somewhere on the page: everything that shows them follows. */
  function onPreferences(learned: NotificationPreferences): void {
    setHeld({ readFrom: readings.notifications, preferences: { ok: true, value: learned } });
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
      <InboxHead clock={clock} onPreferences={onPreferences} onSnoozed={() => refresh()} queue={queue} />
      <div className="inbox__grid">
        <div className="inbox__main">
          {queue !== null && (
            <QueueList
              asOf={queue.asOf}
              clock={clock}
              items={queue.items}
              newKey={newKey}
              onSettled={onSettled}
              afterCards={count === 0 ? <ZeroCard /> : null}
              snoozed={queue.snoozed}
            />
          )}
          <ResolvedList
            clock={clock}
            collapsed={collapsed}
            day={day}
            failure={resolved.failure}
            onCollapse={(folded) => setResolvedCollapsed(readerId, folded)}
            onDay={setDay}
            resolved={resolved.resolved}
          />
        </div>
        <aside aria-label={SIDE_LABEL} className="inbox__side">
          <ChannelsCard
            channels={side.side?.channels ?? null}
            failure={side.failure}
            onPreferences={onPreferences}
            preferences={preferences}
          />
          <PolicyCard card={side.side?.policies ?? null} failure={side.failure} />
        </aside>
      </div>
    </main>
  );
}
