"use client";

import Link from "next/link";

import type { InboxItem, InboxRef, InboxSnoozedItem } from "@/app/api/inbox";
import { prPath, runPath } from "@/app/paths";
import { Chip } from "@/app/ui";

import { CARDS_NOTE, QUEUE_LABEL, SEVERITY, SNOOZED_LABEL, askedAgo, snoozedUntil } from "./view";

/**
 * A ref as a row shows it: a run or a PR links to its page, a ticket or a path is text.
 *
 * @param props.refItem The ref.
 * @returns The tag.
 */
function RefTag({ refItem }: Readonly<{ refItem: InboxRef }>) {
  const href = refItem.type === "run" ? runPath(refItem.id) : refItem.type === "pr" ? prPath(refItem.id) : null;

  return href === null ? (
    <span className="inbox-row__ref">{refItem.label}</span>
  ) : (
    <Link className="inbox-row__ref inbox-row__ref--link" href={href}>
      {refItem.label}
    </Link>
  );
}

/**
 * The queue, as plain rows until the decision cards arrive (BO.1,
 * [#466](https://github.com/NobuData/ouroboros/issues/466)): each asking item's severity,
 * question, tag row and age, newest first as the service ordered them, then the snoozed ones and
 * when each wakes. No action buttons — those are BO.2's
 * ([#467](https://github.com/NobuData/ouroboros/issues/467)) — and no empty state: at zero the
 * head's own sentence already says so.
 *
 * @param props.items The asking items.
 * @param props.snoozed The snoozed items.
 * @param props.clock How an instant is printed.
 * @returns The lists, or nothing for an empty queue.
 */
export function QueueList({
  items,
  snoozed,
  clock,
}: Readonly<{
  items: readonly InboxItem[];
  snoozed: readonly InboxSnoozedItem[];
  clock: (atMs: number) => string;
}>) {
  if (items.length === 0 && snoozed.length === 0) return null;

  return (
    <div className="inbox-queue">
      {items.length > 0 && (
        <section aria-label={QUEUE_LABEL} className="inbox-queue__section">
          <ul className="inbox-queue__list">
            {items.map((item) => (
              <li className="inbox-row" key={item.id}>
                <Chip tone={SEVERITY[item.severity].tone}>{SEVERITY[item.severity].label}</Chip>
                <div className="inbox-row__body">
                  <p className="inbox-row__question">{item.question}</p>
                  <p className="inbox-row__why">{item.why}</p>
                  <div className="inbox-row__meta">
                    {item.refs.map((ref) => (
                      <RefTag key={`${ref.type}:${ref.id}`} refItem={ref} />
                    ))}
                    <span className="inbox-row__age">{askedAgo(item.ageSeconds)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="inbox-queue__note">{CARDS_NOTE}</p>
        </section>
      )}
      {snoozed.length > 0 && (
        <section aria-label={SNOOZED_LABEL} className="inbox-queue__section inbox-queue__section--snoozed">
          <h2 className="inbox-queue__heading">
            {SNOOZED_LABEL} ({snoozed.length})
          </h2>
          <ul className="inbox-queue__list">
            {snoozed.map((item) => (
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
