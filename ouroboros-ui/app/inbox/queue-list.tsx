"use client";

import { type ReactNode, useCallback, useMemo, useState } from "react";

import type { InboxItem, InboxSnoozedItem } from "@/app/api/inbox";

import { InboxCardBoundary } from "./card-boundary";
import { DecisionCard } from "./decision-card";
import { SnoozedList } from "./snoozed-list";
import { QUEUE_LABEL } from "./view";

/**
 * The cards on screen: what the service says is asking, plus the cards this reader pressed here.
 *
 * An answered item leaves the queue at the next read, and its receipt would leave with it — so a
 * card the reader pressed on this page (answered, raced, snoozed, or still in flight) is kept, at
 * the place its age gives it, until the reader leaves. Newest first throughout, as the service
 * orders the queue.
 *
 * @param items The asking items, as last read.
 * @param kept The cards pressed here, as they were when they were pressed.
 * @returns Every card to draw, newest first.
 */
export function cardsOnScreen(items: readonly InboxItem[], kept: ReadonlyMap<string, InboxItem>): InboxItem[] {
  const asking = new Set(items.map((item) => item.id));
  const settled = [...kept.values()].filter((item) => !asking.has(item.id));

  if (settled.length === 0) return [...items];

  return [...items, ...settled].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id),
  );
}

/**
 * The queue (BO.2, [#467](https://github.com/NobuData/ouroboros/issues/467)): one
 * {@link DecisionCard} per asking item, newest first as the service ordered them, then the snoozed
 * ones as dimmed cards with a countdown and *Wake now* ({@link SnoozedList}, BO.5,
 * [#470](https://github.com/NobuData/ouroboros/issues/470)). No empty state: at zero the head's
 * own sentence already says so. Each card stands under its own boundary, so one that cannot be
 * drawn degrades itself and not the queue.
 *
 * A card the reader pressed here stays on screen with its receipt after the queue stops listing
 * the item ({@link cardsOnScreen}); a card snoozed here is dimmed in place rather than repeated in
 * the snoozed section.
 *
 * @param props.items The asking items.
 * @param props.snoozed The snoozed items.
 * @param props.asOf When the queue was read — the service's clock, ISO-8601.
 * @param props.clock How an instant is printed.
 * @param props.onSettled Hears each card that settles here, so the page can recount and re-read.
 * @param props.onWoken Hears each snoozed item woken here, so the page can re-read the queue.
 * @param props.newKey Mints a press's idempotency key — a test seam.
 * @param props.afterCards What the page draws between the cards and the snoozed section — the
 *   *Inbox zero* card (#468), which belongs under the receipts of the cards just answered rather
 *   than above them, where it would push the card the reader is looking at down the page.
 * @returns The cards, the slot and the snoozed section, or nothing when all three are empty.
 */
export function QueueList({
  items,
  snoozed,
  asOf,
  clock,
  onSettled,
  onWoken,
  newKey,
  afterCards = null,
}: Readonly<{
  items: readonly InboxItem[];
  snoozed: readonly InboxSnoozedItem[];
  asOf: string;
  clock: (atMs: number) => string;
  onSettled?: (itemId: string) => void;
  onWoken?: (itemId: string) => void;
  newKey?: () => string;
  afterCards?: ReactNode;
}>) {
  const [kept, setKept] = useState<ReadonlyMap<string, InboxItem>>(new Map());
  const cards = useMemo(() => cardsOnScreen(items, kept), [items, kept]);
  const hidden = snoozed.filter((item) => !kept.has(item.id));
  const asOfSeconds = Math.floor(Date.parse(asOf) / 1000);

  const keep = useCallback(
    (itemId: string) => {
      const item = cards.find((candidate) => candidate.id === itemId);

      if (item !== undefined) setKept((before) => new Map(before).set(itemId, item));
    },
    [cards],
  );

  if (cards.length === 0 && hidden.length === 0 && afterCards === null) return null;

  return (
    <div className="inbox-queue">
      {cards.length > 0 && (
        <section aria-label={QUEUE_LABEL} className="inbox-queue__section">
          <ul className="inbox-queue__cards">
            {cards.map((item) => (
              <li key={item.id}>
                <InboxCardBoundary label={item.question}>
                  <DecisionCard
                    asOfSeconds={asOfSeconds}
                    clock={clock}
                    item={item}
                    newKey={newKey}
                    onPressed={keep}
                    onSettled={onSettled}
                  />
                </InboxCardBoundary>
              </li>
            ))}
          </ul>
        </section>
      )}
      {afterCards}
      <SnoozedList asOfSeconds={asOfSeconds} clock={clock} items={hidden} onWoken={onWoken} />
    </div>
  );
}
