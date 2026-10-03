/**
 * Where a time series' marker chips go — the collision-aware half of the annotation layer
 * (BW.2, [#517](https://github.com/NobuData/ouroboros/issues/517)), pure and tested on its own in
 * `__tests__/charts/marks.test.ts`.
 *
 * Mockup 18 draws three chips over ninety days and stacks the middle one a row down. Three is the
 * easy case: six breakpoints in one fortnight would overlap into a smear, so every chip is given
 * a row it shares with nothing it touches.
 *
 * ### Why the arithmetic is in rem
 *
 * A chip is HTML, not SVG text: a real button with real, rem-sized type. Its width is therefore a
 * number of `ch` plus padding — a rem length — while its anchor is a *fraction* of the chart's
 * width. The two only meet at a known width, and the narrowest one is known: the scroll wrapper's
 * `min-width`, also in rem. So the layout is solved once, at that narrowest width, in rem, and it
 * holds at every wider one and at every font scale:
 *
 * - two chips anchored to their verticals drift **apart** as the chart widens;
 * - a chip held against the right edge keeps its distance from the edge, while everything to its
 *   left moves further left of it.
 *
 * `charts.css` positions a chip with the same two rules — after its vertical, or against the right
 * edge, whichever is further left — and `__tests__/charts/charts-styles.test.ts` holds the
 * constants below to the sheet's declarations.
 */

/** The narrowest a chart is drawn, in rem — `.chart-scroll__inner`'s `min-width`, per size. */
export const CHART_MIN_WIDTH_REM = { wide: 40, half: 30 } as const;

/** A chip's type size, in rem — the sheet's `--t-2xs`. */
export const MARK_FONT_REM = 0.6875;

/**
 * The widest a monospace advance is taken to be, in em. IBM Plex Mono's is `0.6`, but a renderer
 * that hints snaps it to whole pixels — `7px` of an `11px` face, which is `0.636` — so the
 * estimate is taken just wide of that. The sheet sizes a chip in real `ch`; this only has to
 * never be narrower than one.
 */
export const MARK_CH_EM = 0.64;

/** Slack inside a chip, in `ch`, so text that exactly fits is never ellipsised by rounding. */
export const MARK_SLACK_CH = 0.25;

/** A chip's inline padding, each side, in rem — `--sp-3`. */
export const MARK_PAD_REM = 0.375;

/** A chip's two hairline borders, in rem — `--sp-1`. */
export const MARK_BORDER_REM = 0.125;

/** How far after its vertical a chip starts, in rem — `--sp-2`. */
export const MARK_OFFSET_REM = 0.25;

/** The least room between two chips of one row, in rem. */
export const MARK_GAP_REM = 0.25;

/** One row of chips: a chip's height and the room under it, in rem. */
export const MARK_ROW_REM = 1.375;

/** What the layout needs to know about the chart the chips sit over. */
export interface MarkMeasure {
  /** The narrowest the chart is ever drawn, in rem. */
  readonly widthRem: number;
  /** The plot's right inset, as a fraction of the chart's width — where a chip must end. */
  readonly end: number;
}

/** One chip to place. */
export interface MarkInput {
  /** Its vertical's x, as a fraction of the chart's width. */
  readonly x: number;
  /** How many characters its label has. */
  readonly chars: number;
}

/** Where one chip went. */
export interface MarkPlacement {
  /** Its row, `0` at the top. */
  readonly row: number;
  /** The characters it has room for — its label's, or fewer for a label wider than the plot. */
  readonly chars: number;
  /** Its left and right edges at the narrowest width, in rem. */
  readonly left: number;
  readonly right: number;
}

/** A whole layout. */
export interface MarkLayout {
  /** One placement per input, in the input's order. */
  readonly placements: readonly MarkPlacement[];
  /** How many rows the chips take. */
  readonly rows: number;
}

/**
 * How wide a chip of so many characters is.
 *
 * @param chars The characters.
 * @returns Its border-box width, in rem.
 */
export function markWidthRem(chars: number): number {
  return (chars + MARK_SLACK_CH) * MARK_CH_EM * MARK_FONT_REM + 2 * MARK_PAD_REM + MARK_BORDER_REM;
}

/**
 * The longest label a chip can show in full: one as wide as the whole plot at its narrowest.
 *
 * @param measure The chart.
 * @returns The character count, at least one.
 */
export function maxMarkChars(measure: MarkMeasure): number {
  const room = measure.widthRem * (1 - measure.end) - 2 * MARK_PAD_REM - MARK_BORDER_REM;

  return Math.max(1, Math.floor(room / (MARK_CH_EM * MARK_FONT_REM) - MARK_SLACK_CH));
}

/**
 * Give every chip a row it shares with nothing it touches.
 *
 * Chips are taken left to right and each takes the highest row with room, so a cluster steps
 * down and to the right like a staircase — each chip beside its own vertical — and a chip far
 * from the cluster goes back to the top row. A chip that would run past the right edge is held
 * against it instead, which is how the mockup draws its last chip.
 *
 * @param marks The chips, in any order.
 * @param measure The chart they sit over.
 * @returns Each chip's row and room, and how many rows there are — none for no chips.
 */
export function layoutMarks(marks: readonly MarkInput[], measure: MarkMeasure): MarkLayout {
  const width = measure.widthRem;
  const limit = maxMarkChars(measure);
  const rows: MarkPlacement[][] = [];
  const placements = new Array<MarkPlacement>(marks.length);

  const order = marks.map((_, index) => index).sort((a, b) => marks[a]!.x - marks[b]!.x || a - b);

  for (const index of order) {
    const mark = marks[index]!;
    const chars = Math.min(Math.max(1, Math.round(mark.chars)), limit);
    const span = markWidthRem(chars);
    const x = Math.min(Math.max(Number.isFinite(mark.x) ? mark.x : 0, 0), 1);
    const left = Math.max(0, Math.min(x * width + MARK_OFFSET_REM, width * (1 - measure.end) - span));
    const right = left + span;

    let row = rows.findIndex((taken) =>
      taken.every((other) => left >= other.right + MARK_GAP_REM || right + MARK_GAP_REM <= other.left),
    );
    if (row < 0) row = rows.push([]) - 1;

    const placement: MarkPlacement = { row, chars, left, right };
    rows[row]!.push(placement);
    placements[index] = placement;
  }

  return { placements, rows: rows.length };
}
