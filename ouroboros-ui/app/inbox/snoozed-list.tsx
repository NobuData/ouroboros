"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";

import type { InboxRef, InboxSnoozedItem } from "@/app/api/inbox";
import { ageOfSeconds } from "@/app/format";
import { useSecondsNow } from "@/app/shell/clock";
import { Button, Card, Chip } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import { InboxCardBoundary } from "./card-boundary";
import { liveAgeSeconds, sitePath } from "./card-view";
import { unsnoozeDecision } from "./inbox-actions";
import { WAKE_FAILED, WAKE_LABEL, WAKING, WOKEN, wakeLabel, wakeReason, wakesIn } from "./snoozed-view";
import { SEVERITY, SNOOZED_LABEL, askedAgo, snoozedUntil } from "./view";

/** The left border each severity draws in. */
const SEVERITY_CLASS: Readonly<Record<InboxSnoozedItem["severity"], string>> = {
  err: "inbox-snoozed__body--err",
  warn: "inbox-snoozed__body--warn",
  info: "inbox-snoozed__body--info",
};

/** Where a snoozed card's wake stands. */
type WakePhase =
  | { readonly kind: "idle" }
  | { readonly kind: "waking" }
  | { readonly kind: "woken" }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * A ref as a snoozed card shows it: a link to the destination the service resolved, or text.
 *
 * @param props.refItem The ref.
 * @returns The tag.
 */
function RefTag({ refItem }: Readonly<{ refItem: InboxRef }>) {
  const href = sitePath(refItem.href);

  return href === null ? (
    <span className="inbox-snoozed__ref">{refItem.label}</span>
  ) : (
    <Link className="inbox-snoozed__ref inbox-snoozed__ref--link" href={href}>
      {refItem.label}
    </Link>
  );
}

/** What {@link SnoozedCard} takes. */
interface SnoozedCardProps {
  /** The item, as BN.4 rendered it. */
  readonly item: InboxSnoozedItem;
  /** The service's clock when the queue was read, whole seconds — what the clocks count from. */
  readonly asOfSeconds: number;
  /** How an instant is printed — `14:20`. */
  readonly clock: (atMs: number) => string;
  /** Hears that the item was woken here, so the page can re-read the queue. */
  readonly onWoken?: (itemId: string) => void;
}

/**
 * One snoozed decision: dimmed, with its severity, its question, the age it was asked at — still
 * counting, because a snooze never stops a decision's clock — and a live countdown to when it
 * comes back on its own.
 *
 * **Wake now** brings it back early. It follows the item's `snooze.allowed`, as the decision
 * card's *Snooze* does: for a reader who may not snooze it is drawn inert with the reason, never
 * hidden. A woken card says it is back in the queue until the next read moves it there; a
 * refused wake leaves the card snoozed with the reason under it.
 *
 * @param props See {@link SnoozedCardProps}.
 * @returns The card.
 */
function SnoozedCard({ item, asOfSeconds, clock, onWoken }: SnoozedCardProps) {
  const question = useId();
  const [phase, setPhase] = useState<WakePhase>({ kind: "idle" });
  const busy = useRef(false);
  const now = useSecondsNow(asOfSeconds);
  const age = liveAgeSeconds(item, now);
  const reason = wakeReason(item, phase.kind === "waking");

  /** Wake it: one press at a time, and the page re-reads once the service says it is back. */
  function wake(): void {
    if (busy.current) return;

    busy.current = true;
    setPhase({ kind: "waking" });

    void unsnoozeDecision(item.id)
      .then((outcome) => {
        if (outcome.ok) {
          setPhase({ kind: "woken" });
          onWoken?.(item.id);
        } else {
          setPhase({ kind: "failed", reason: outcome.reason });
        }
      })
      .catch(() => setPhase({ kind: "failed", reason: WAKE_FAILED }))
      .finally(() => {
        busy.current = false;
      });
  }

  return (
    <article aria-labelledby={question} className="inbox-snoozed">
      <Card className={cx("inbox-snoozed__body", SEVERITY_CLASS[item.severity])}>
        <div className="inbox-snoozed__q-row">
          <Chip tone={SEVERITY[item.severity].tone}>{SEVERITY[item.severity].label}</Chip>
          <h3 className="inbox-snoozed__question" id={question}>
            {item.question}
          </h3>
          <span className="inbox-snoozed__age">
            <span aria-hidden>{ageOfSeconds(age)}</span>
            <span className="sr-only">{askedAgo(age)}</span>
          </span>
        </div>
        {item.refs.length > 0 && (
          <div className="inbox-snoozed__refs">
            {item.refs.map((ref) => (
              <RefTag key={`${ref.type}:${ref.id}`} refItem={ref} />
            ))}
          </div>
        )}
        <div className="inbox-snoozed__foot">
          <p aria-live="polite" className="inbox-snoozed__status" role="status">
            {phase.kind === "woken" ? (
              WOKEN
            ) : (
              <>
                <span className="inbox-snoozed__countdown">{wakesIn(item, now)}</span>
                <span className="inbox-snoozed__until">{snoozedUntil(item, clock)}</span>
              </>
            )}
          </p>
          {phase.kind !== "woken" && (
            <Button aria-label={wakeLabel(item)} onClick={wake} reason={reason} size="sm" tone="ghost">
              {phase.kind === "waking" ? WAKING : WAKE_LABEL}
            </Button>
          )}
        </div>
        {phase.kind === "failed" && (
          <p className="inbox-snoozed__failure" role="alert">
            {phase.reason}
          </p>
        )}
      </Card>
    </article>
  );
}

/**
 * The snoozed section (BO.5, [#470](https://github.com/NobuData/ouroboros/issues/470)) — every
 * decision snoozed elsewhere, as dimmed cards under the queue. A card snoozed on this page stays
 * where it was, dimmed in place, and is not repeated here (`QueueList`).
 *
 * Snoozed items are out of the **Needs You** badge — the service's `head.count` already leaves
 * them out — and in the week's figures, whose clocks a snooze never stops.
 *
 * @param props.items The snoozed items to draw.
 * @param props.asOfSeconds The service's clock when the queue was read, whole seconds.
 * @param props.clock How an instant is printed.
 * @param props.onWoken Hears each item woken here.
 * @returns The section, or nothing when no item is snoozed.
 */
export function SnoozedList({
  items,
  asOfSeconds,
  clock,
  onWoken,
}: Readonly<{
  items: readonly InboxSnoozedItem[];
  asOfSeconds: number;
  clock: (atMs: number) => string;
  onWoken?: (itemId: string) => void;
}>) {
  if (items.length === 0) return null;

  return (
    <section aria-label={SNOOZED_LABEL} className="inbox-queue__section inbox-queue__section--snoozed">
      <h2 className="inbox-queue__heading">
        {SNOOZED_LABEL} ({items.length})
      </h2>
      <ul className="inbox-queue__list">
        {items.map((item) => (
          <li key={item.id}>
            <InboxCardBoundary label={item.question}>
              <SnoozedCard asOfSeconds={asOfSeconds} clock={clock} item={item} onWoken={onWoken} />
            </InboxCardBoundary>
          </li>
        ))}
      </ul>
    </section>
  );
}
