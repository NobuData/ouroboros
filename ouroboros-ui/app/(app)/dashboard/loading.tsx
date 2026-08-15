import type { ReactNode } from "react";

import { Card } from "@/app/ui";

import "@/app/dashboard/dashboard.css";

/**
 * What the reader sees while the dashboard's three reads are in flight.
 *
 * The design system asks every surface to design its loading state rather than leave a
 * blank region (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.3), and Next.js's `loading.tsx` is
 * how a route says what that is: the framework wraps the segment in a Suspense boundary
 * with this as the fallback, so the shell, the sidebar and the page's own frame are painted
 * immediately and only the cards wait.
 *
 * ### Each card's own shape, not nine of one shape
 *
 * A skeleton exists to stop the page moving when the data lands, and the only way it can is
 * by reserving the height the card will actually take
 * ([#86](https://github.com/NobuData/ouroboros/issues/86)). The nine cards are not alike —
 * a stat tile is a caption over one large figure, the tables are rows, the pulse card is a
 * picture over three meters with a switch under a rule — so each is drawn as itself, from
 * classes that mirror the card's own (`app/dashboard/dashboard.css`). The shapes are
 * declared once in {@link CARDS} and rendered by {@link Shape}, so the grid's order and
 * spans are stated in one place and can be read against the screen's.
 *
 * **It says one thing to a screen reader, not thirty.** The bars are decoration: they carry
 * no text, and the region is marked `aria-busy` and labelled once. Reading out a dozen
 * empty boxes would be worse than saying nothing.
 *
 * @returns The skeleton.
 */
export default function Loading() {
  return (
    <div className="dash" aria-busy="true" aria-label="Loading the dashboard">
      <div className="dash__head">
        <div className="dash__headings dash-skeleton">
          <span className="dash-skeleton__bar dash-skeleton__bar--half" />
          <span className="dash-skeleton__bar dash-skeleton__bar--tall" />
        </div>
      </div>

      <div className="dash-grid" aria-hidden>
        {CARDS.map((card, index) => (
          // A plain card, not a region: it names nothing, and nine unnamed regions in the
          // accessibility tree would be worse than the `aria-hidden` this grid already
          // carries. `fill` on every one, so a card whose skeleton is shorter than its row
          // still stretches rather than leaving a gap the real card will not leave.
          <Card fill className={`dash-col--${card.span}`} key={index}>
            <Shape card={card} />
          </Card>
        ))}
      </div>
    </div>
  );
}

/** One card of the grid, as the skeleton stands in for it. */
interface SkeletonCard {
  /** Which of the grid's column spans it takes — the screen's own. */
  readonly span: 3 | 4 | 5 | 7 | 8;
  /**
   * Which shape it is. `stat` has no card head; the other four do, so their bodies start
   * where the real card's does.
   */
  readonly shape: "stat" | "rows" | "pulse";
  /** How many rows, for a `rows` card — the number the card draws when it has data. */
  readonly rows?: number;
}

/**
 * The nine cards, in the order the screen lays them out and at the spans it gives them: the
 * four-tile stat row, then the mockup's wide pairs with the two `c-4` cards between them.
 *
 * Written down here rather than derived from the screen because they are the *shape* of the
 * page, which is exactly what a skeleton is for — a skeleton computed from the data it is
 * standing in for would have nothing to draw. The row counts are each card's own: three
 * loops, three system dependencies, four completions, five queued issues, which is what the
 * seeded workspace draws and therefore the height most first paints resolve to.
 */
const CARDS: readonly SkeletonCard[] = [
  { span: 3, shape: "stat" },
  { span: 3, shape: "stat" },
  { span: 3, shape: "stat" },
  { span: 3, shape: "stat" },
  { span: 8, shape: "rows", rows: 3 },
  { span: 4, shape: "pulse" },
  { span: 4, shape: "rows", rows: 3 },
  { span: 7, shape: "rows", rows: 4 },
  { span: 5, shape: "rows", rows: 5 },
];

/**
 * One card's insides.
 *
 * @param props.card What it is standing in for.
 * @returns The bars, at that card's geometry.
 */
function Shape({ card }: Readonly<{ card: SkeletonCard }>) {
  if (card.shape === "stat") return <StatShape />;
  if (card.shape === "pulse") return <PulseShape />;

  return <RowsShape rows={card.rows ?? 1} />;
}

/**
 * A stat tile: the caption, the figure, the line under it — `.dash-stat`'s three children.
 *
 * @returns The bars.
 */
function StatShape(): ReactNode {
  return (
    <div className="dash-skeleton">
      <span className="dash-skeleton__bar dash-skeleton__bar--caption" />
      <span className="dash-skeleton__bar dash-skeleton__bar--tall" />
      <span className="dash-skeleton__bar dash-skeleton__bar--line" />
    </div>
  );
}

/**
 * A card of rows: the head, then the rules the rows are drawn between.
 *
 * One shape for the two tables, the system list and the queue card, because all four are the
 * same thing — a head over ruled rows — and four near-identical shapes would be four places
 * to change the day the rhythm does.
 *
 * @param props.rows How many rows the card draws.
 * @returns The bars.
 */
function RowsShape({ rows }: Readonly<{ rows: number }>): ReactNode {
  return (
    <>
      <span className="dash-skeleton__head" />
      <div className="dash-skeleton__rows">
        {Array.from({ length: rows }, (_, index) => (
          <span className="dash-skeleton__row" key={index}>
            <span className="dash-skeleton__cell dash-skeleton__cell--grow" />
            <span className="dash-skeleton__cell dash-skeleton__cell--mark" />
          </span>
        ))}
      </div>
    </>
  );
}

/**
 * The pulse card: the mark's box, three captioned meters, the rule, and the switch under it.
 *
 * The tallest card on the grid and the one with the most to reserve — the glyph's box is
 * held at the asset's own ratio for the same reason the card itself holds it, so nothing
 * moves when the picture arrives.
 *
 * @returns The bars.
 */
function PulseShape(): ReactNode {
  return (
    <>
      <span className="dash-skeleton__head" />
      <div className="dash-skeleton">
        <span className="dash-skeleton__glyph" />
        {Array.from({ length: PULSE_METERS }, (_, index) => (
          <span className="dash-skeleton__meter" key={index}>
            <span className="dash-skeleton__bar dash-skeleton__bar--caption" />
            <span className="dash-skeleton__bar dash-skeleton__bar--wide" />
          </span>
        ))}
        <span className="dash-skeleton__divider" />
        <span className="dash-skeleton__bar dash-skeleton__bar--half" />
      </div>
    </>
  );
}

/** How many meters the pulse card draws — `pulseMeters()`'s three. */
const PULSE_METERS = 3;
