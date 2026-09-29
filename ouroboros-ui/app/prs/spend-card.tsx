"use client";

import Link from "next/link";
import { useId } from "react";

import { Card, CardHead, cx } from "@/app/ui";

import {
  ROUTING_HREF,
  ROUTING_LINK,
  SPEND_TITLE,
  type SpendCapView,
  type SpendCardView,
} from "./spend";

/** The element id the card sits at — what a link to the card is addressed to. */
export const SPEND_ID = "spend";

/** The class each cap verdict takes. */
const CAP_CLASS: Record<SpendCapView["tone"], string> = {
  ok: "prv-spend__cap--ok",
  err: "prv-spend__cap--err",
  neutral: "prv-spend__cap--neutral",
};

/**
 * The Spend card ([#369](https://github.com/NobuData/ouroboros/issues/369)) — mockup 12's spend
 * rollup: what the loop spent, how much of it was verification, and the cap it is held to.
 *
 * Every figure is `spend.ts`'s; this file only draws. An unpriced figure is an em-dash on screen
 * and *not priced* to a screen reader — a dash read aloud is a pause, which says nothing.
 *
 * @param props.view The card, from `spendCard`.
 * @returns The card.
 */
export function SpendCard({ view }: Readonly<{ view: SpendCardView }>) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="prv-spend" id={SPEND_ID}>
      <Card>
        <CardHead
          title={SPEND_TITLE}
          titleId={titleId}
          trailing={
            <Link className="prv-gates__link" href={ROUTING_HREF}>
              {ROUTING_LINK}
            </Link>
          }
        />

        {view.empty !== null && <p className="prv-spend__note">{view.empty}</p>}

        {view.rows.length > 0 && (
          <dl className="prv-spend__rows">
            {view.rows.map((row) => (
              <div className="prv-spend__row" key={row.label}>
                <dt className="prv-spend__key">{row.label}</dt>
                <dd className="prv-spend__figure">
                  <span aria-hidden="true">{row.figure}</span>
                  <span className="sr-only">{row.spoken}</span>
                  {row.note !== null && <span className="prv-spend__bound">{row.note}</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {view.cap !== null && (
          <p className={cx("prv-spend__cap", CAP_CLASS[view.cap.tone])}>{view.cap.text}</p>
        )}
      </Card>
    </section>
  );
}
