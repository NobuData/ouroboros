import type { RoutingSpend } from "@/app/api/routing";
import { Button, Card, CardHead, EmptyState, Meter, cx } from "@/app/ui";

import {
  FULL_REPORT,
  FULL_REPORT_REASON,
  NO_SPEND_TITLE,
  type SpendRow,
  UNPRICED,
  noSpendNote,
  spendRows,
  spendTitle,
  localShareNote,
} from "./spend";

import "./models.css";

/**
 * Mockup 06's **SPEND BY PROVIDER · 30D** card
 * ([#204](https://github.com/NobuData/ouroboros/issues/204)): one metered row per provider,
 * widths relative to the largest, the local row on the ok-meter, and the local-share
 * footnote.
 *
 * Every figure arrives already decided from `app/models/spend.ts`, so this file is a
 * description of a card plus the one thing the module note there is about: the two states of
 * a row's amount are drawn as two different things. An amount is a mono figure with a meter
 * under it; *unpriced* is a word in its own treatment with a dashed track where the meter
 * would be, so a reader scanning the column cannot take it for `$0.00`. That is DASH-J.4's
 * ([#92](https://github.com/NobuData/ouroboros/issues/92)) distinction on this surface, and
 * the reason the row does not simply draw an empty meter.
 *
 * A Server Component: nothing on this card changes on the client. The meters are widths, the
 * figures are strings, and **Full report →** is inert until AB.4
 * ([#210](https://github.com/NobuData/ouroboros/issues/210)) gives it somewhere to go —
 * drawn as a `Button` with a `reason` rather than as a link, because an inert link has no
 * honest rendering and a link to a `404` is a dead end wearing an arrow.
 */

/** The id the card's `aria-labelledby` points at. */
const SPEND_TITLE_ID = "models-spend-title";

/**
 * The card.
 *
 * @param props.spend The card's payload, read with the matrix.
 * @returns The card: rows and a footnote, or the zero-state for a workspace that has spent
 *   nothing in the window.
 */
export function SpendCard({ spend }: Readonly<{ spend: RoutingSpend }>) {
  const rows = spendRows(spend);
  const note = localShareNote(spend);

  return (
    <Card aria-labelledby={SPEND_TITLE_ID} as="section" fill>
      <CardHead
        title={spendTitle(spend.window.days)}
        titleId={SPEND_TITLE_ID}
        trailing={
          <Button reason={FULL_REPORT_REASON} size="sm" tone="ghost">
            {FULL_REPORT}
          </Button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState fill note={noSpendNote(spend.window.days)} title={NO_SPEND_TITLE} />
      ) : (
        <>
          <ul className="models-spend">
            {rows.map((row) => (
              <SpendRowView key={row.key} row={row} />
            ))}
          </ul>
          {note !== null && <p className="models-spend__note">{note}</p>}
        </>
      )}
    </Card>
  );
}

/**
 * One row: the name and the amount on one line, the meter under them.
 *
 * The meter is `aria-hidden` — the primitive's own rule when it is given no label — because
 * the line above it already says the figure, and a progress bar announcing `31%` beside a
 * figure saying `$412.80` would be two claims about one row.
 *
 * @param props.row The decided row.
 * @returns The row.
 */
function SpendRowView({ row }: Readonly<{ row: SpendRow }>) {
  const unpriced = row.amount === null;

  return (
    <li className={cx("models-spend__row", unpriced && "models-spend__row--unpriced")}>
      <div className="models-spend__line">
        <span className="models-spend__name">{row.name}</span>
        <span className="models-spend__figure">
          {unpriced ? (
            <span className="models-spend__unpriced">{UNPRICED}</span>
          ) : (
            <span className="models-spend__amount">{row.amount}</span>
          )}
          {/*
            Both facts at once: a priced total beside the count of calls the total does not
            include. It is drawn only when there are some, so a row every call of which was
            priced carries no note to read past.
          */}
          {row.unpriced !== null && !unpriced && (
            <span className="models-spend__partial">{row.unpriced}</span>
          )}
        </span>
      </div>
      {row.meter === null ? (
        // Not an empty meter: an empty meter is what a row that cost nothing looks like.
        <span aria-hidden className="models-spend__track--unpriced" />
      ) : (
        <Meter className="models-spend__meter" tone={row.tone} value={row.meter} />
      )}
    </li>
  );
}
