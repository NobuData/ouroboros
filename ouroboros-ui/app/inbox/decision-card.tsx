"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";

import type { InboxItem } from "@/app/api/inbox";
import { ageOfSeconds } from "@/app/format";
import { useSecondsNow } from "@/app/shell/clock";
import { Card, Tag } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import {
  ANSWERING,
  IDLE,
  RECEIPT_LABEL,
  RECEIPT_MARK,
  isAsking,
  liveAgeSeconds,
  raceLine,
  receiptLine,
  sitePath,
  snoozedLine,
  whySegments,
} from "./card-view";
import { DecisionActions } from "./decision-actions";
import { type DecisionOptions, useDecision } from "./use-decision";
import { SEVERITY, askedAgo } from "./view";

/** The border and dot each severity draws in. */
const SEVERITY_CLASS: Readonly<Record<InboxItem["severity"], string>> = {
  err: "inbox-card__body--err",
  warn: "inbox-card__body--warn",
  info: "inbox-card__body--info",
};

/** What {@link DecisionCard} takes. */
export interface DecisionCardProps extends DecisionOptions {
  /** The item, as BN.4 rendered it. */
  readonly item: InboxItem;
  /** How an instant is printed — `14:20`. */
  readonly clock: (atMs: number) => string;
  /**
   * The service's clock when the queue was read, whole seconds since the epoch — what the age is
   * counted from on the server render and the hydration pass that has to match it.
   */
  readonly asOfSeconds: number;
}

/**
 * One decision, drawn entirely from its kind's declaration and the rendered payload (BO.2,
 * [#467](https://github.com/NobuData/ouroboros/issues/467), mockup 16, decision X1).
 *
 * **There is one card, and it knows nothing about kinds.** Severity, question, age, refs, why and
 * the action row all arrive on the item; this component lays them out and `card-view.ts` holds
 * the few rules about their shapes. Nothing here — or there — names a kind, an action or a
 * route, which is what lets a kind registered tomorrow render with no change to either.
 *
 * - **Severity** is the left border and the dot, and is also said in words for a reader who
 *   cannot see either.
 * - **The age ticks.** It is counted from when the item was asked, on the page's one shared
 *   clock, so `8m` becomes `9m` without a reload and a poll cannot move it.
 * - **Refs are navigation.** Each tag is a link to the destination the service resolved for it —
 *   the run console, PR verification, intake, the diff — and a tag with no page is plain.
 * - **Answering has three ends**: the receipt (what executed, with links), *someone else answered
 *   first* (who, when, with what — a state of the card, never an error), and a failure that
 *   leaves the card asking with the reason beside its buttons.
 * - **A snoozed card dims** and says when it returns.
 *
 * The card is a tab stop of its own, named by its question, and when it settles the focus that
 * was on a button now gone moves to the card, whose description is the receipt.
 *
 * @param props See {@link DecisionCardProps}.
 * @returns The card.
 */
export function DecisionCard({ item, clock, asOfSeconds, onPressed, onSettled, newKey }: DecisionCardProps) {
  const question = useId();
  const status = useId();
  const frame = useRef<HTMLElement>(null);
  const controls = useDecision(item, { onPressed, onSettled, newKey });
  const now = useSecondsNow(asOfSeconds);
  // A snooze made here has run out: the item is asking again, and so is its card.
  const phase = controls.phase.kind === "snoozed" && now * 1000 >= controls.phase.untilMs ? IDLE : controls.phase;
  const asking = isAsking(phase);
  const age = liveAgeSeconds(item, now);

  useEffect(() => {
    // The buttons are gone. A reader who was on one has been dropped onto the document; land them
    // on the card instead. Focus that is anywhere else is the reader's own and is left alone.
    if (!asking && (document.activeElement === null || document.activeElement === document.body)) {
      frame.current?.focus();
    }
  }, [asking]);

  return (
    <article
      aria-describedby={asking ? undefined : status}
      aria-labelledby={question}
      className={cx("inbox-card", phase.kind === "snoozed" && "inbox-card--snoozed")}
      ref={frame}
      tabIndex={0}
    >
      <Card className={cx("inbox-card__body", SEVERITY_CLASS[item.severity])}>
        <div className="inbox-card__q-row">
          <span aria-hidden className="inbox-card__dot" />
          <span className="sr-only">{SEVERITY[item.severity].label}: </span>
          <h2 className="inbox-card__question" id={question}>
            {item.question}
          </h2>
          <span className="inbox-card__age">
            <span aria-hidden>{ageOfSeconds(age)}</span>
            <span className="sr-only">{askedAgo(age)}</span>
          </span>
        </div>
        {(item.refs.length > 0 || item.tags.length > 0) && (
          <div className="inbox-card__refs">
            {item.refs.map((ref) => {
              const href = sitePath(ref.href);

              return href === null ? (
                <Tag className="inbox-card__tag" key={`${ref.type}:${ref.id}`}>
                  {ref.label}
                </Tag>
              ) : (
                <Link className="inbox-card__ref" href={href} key={`${ref.type}:${ref.id}`}>
                  <Tag className="inbox-card__tag">{ref.label}</Tag>
                </Link>
              );
            })}
            {item.tags.map((tag) => (
              <Tag className="inbox-card__tag" key={`tag:${tag}`}>
                {tag}
              </Tag>
            ))}
          </div>
        )}
        <p className="inbox-card__why">
          {whySegments(item.why, item.facts).map((segment, index) =>
            segment.mono ? (
              // The paragraph never reorders, so a stretch's place in it is its identity.
              <span className="inbox-card__mono" key={`${String(index)}:${segment.text}`}>
                {segment.text}
              </span>
            ) : (
              segment.text
            ),
          )}
        </p>
        {asking && <DecisionActions controls={{ ...controls, phase }} item={item} />}
        {phase.kind === "failed" && (
          <p className="inbox-card__failure" role="alert">
            {phase.reason}
          </p>
        )}
        <p aria-live="polite" className="inbox-card__status" id={status} role="status">
          {phase.kind === "answering" && <span className="inbox-card__pending">{ANSWERING}</span>}
          {phase.kind === "answered" && (
            <>
              <span aria-hidden className="inbox-card__tick">
                {RECEIPT_MARK}
              </span>
              <span className="sr-only">{RECEIPT_LABEL}: </span>
              <span className="inbox-card__receipt">{receiptLine(phase.receipt)}</span>
              {phase.receipt.links.map((link) => {
                const href = sitePath(link.href);

                return href === null ? null : (
                  <Link className="inbox-card__receipt-link" href={href} key={href}>
                    {link.label} →
                  </Link>
                );
              })}
            </>
          )}
          {phase.kind === "raced" && (
            <span className="inbox-card__raced">{raceLine(phase.winner, item.actions, now * 1000)}</span>
          )}
          {phase.kind === "snoozed" && (
            <span className="inbox-card__snoozed-until">{snoozedLine(phase.untilMs, clock)}</span>
          )}
        </p>
      </Card>
    </article>
  );
}
