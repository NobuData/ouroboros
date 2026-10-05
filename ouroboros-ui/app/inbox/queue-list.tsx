"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import type { InboxItem, InboxRef, InboxSnoozedItem } from "@/app/api/inbox";
import { Chip } from "@/app/ui";

import { sitePath } from "./card-view";
import { DecisionCard } from "./decision-card";
import { QUEUE_LABEL, SEVERITY, SNOOZED_LABEL, snoozedUntil } from "./view";

/**
 * A ref as a snoozed row shows it: a link to the destination the service resolved, or text.
 *
 * @param props.refItem The ref.
 * @returns The tag.
 */
function RefTag({ refItem }: Readonly<{ refItem: InboxRef }>) {
  const href = sitePath(refItem.href);

  return href === null ? (
    <span className="inbox-row__ref">{refItem.label}</span>
  ) : (
    <Link className="inbox-row__ref inbox-row__ref--link" href={href}>
      {refItem.label}
    </Link>
  );
}

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
 * ones as plain rows with when each wakes (their section is BO.5's,
 * [#470](https://github.com/NobuData/ouroboros/issues/470)). No empty state: at zero the head's
 * own sentence already says so.
 *
 * A card the reader pressed here stays on screen with its receipt after the queue stops listing
 * the item ({@link cardsOnScreen}); a card snoozed here is dimmed in place rather than repeated in
 * the snoozed rows.
 *
 * @param props.items The asking items.
 * @param props.snoozed The snoozed items.
 * @param props.asOf When the queue was read — the service's clock, ISO-8601.
 * @param props.clock How an instant is printed.
 * @param props.onSettled Hears each card that settles here, so the page can recount and re-read.
 * @param props.newKey Mints a press's idempotency key — a test seam.
 * @returns The cards and the snoozed rows, or nothing for an empty queue.
 */
export function QueueList({
  items,
  snoozed,
  asOf,
  clock,
  onSettled,
  newKey,
}: Readonly<{
  items: readonly InboxItem[];
  snoozed: readonly InboxSnoozedItem[];
  asOf: string;
  clock: (atMs: number) => string;
  onSettled?: (itemId: string) => void;
  newKey?: () => string;
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

  if (cards.length === 0 && hidden.length === 0) return null;

  return (
    <div className="inbox-queue">
      {cards.length > 0 && (
        <section aria-label={QUEUE_LABEL} className="inbox-queue__section">
          <ul className="inbox-queue__cards">
            {cards.map((item) => (
              <li key={item.id}>
                <DecisionCard
                  asOfSeconds={asOfSeconds}
                  clock={clock}
                  item={item}
                  newKey={newKey}
                  onPressed={keep}
                  onSettled={onSettled}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {hidden.length > 0 && (
        <section aria-label={SNOOZED_LABEL} className="inbox-queue__section inbox-queue__section--snoozed">
          <h2 className="inbox-queue__heading">
            {SNOOZED_LABEL} ({hidden.length})
          </h2>
          <ul className="inbox-queue__list">
            {hidden.map((item) => (
              <li className="inbox-row inbox-row--snoozed" key={item.id}>
                <Chip tone={SEVERITY[item.severity].tone}>{SEVERITY[item.severity].label}</Chip>
                <div className="inbox-row__body">
                  <p className="inbox-row__question">{item.question}</p>
                  <div className="inbox-row__meta">
                    {item.refs.map((ref) => (
                      <RefTag key={`${ref.type}:${ref.id}`} refItem={ref} />
                    ))}
                    <span className="inbox-row__age">{snoozedUntil(item, clock)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
