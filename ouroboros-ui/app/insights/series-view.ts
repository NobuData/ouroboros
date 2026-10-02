/**
 * Every decision the throughput and daily-cost cards make, and every sentence they say
 * (BK.3, [#444](https://github.com/NobuData/ouroboros/issues/444)).
 *
 * Mockup 15's two time-series cards carry four pieces of furniture that each encode a claim — the
 * crosshair tooltip, the budget guide, the spike label and the projection footer — and each is
 * built here from what BJ.2 serves ([#438](https://github.com/NobuData/ouroboros/issues/438)) and
 * nothing else, so every honesty gate is a unit test on a small value rather than an assertion
 * about markup.
 *
 * **Framework-free and pure**, as `app/insights/view.ts` is.
 *
 * ### What is never invented
 *
 * - **A cost of `$0.00` for an unpriced day.** The tooltip's cost fragment is omitted when the day
 *   carries no `costCents`, so an unpriced workspace reads `Aug 4 — 6 merged · 1 intervention`.
 * - **A budget.** The guide is the workspace's real provider caps (`budget`), absent when none is
 *   set — a plausible line would put a number in a reader's head nothing configured supports.
 * - **A cause.** The mockup's `$31.40 — Zephyr migration spike` is illustrative. The contract's
 *   `spike` is a day and an amount with nothing attributing it, so the label is the bare value.
 * - **An alert.** *"alerts fire at 90%"* is a promise about behaviour, and nothing fires a cap
 *   alert until AF.4 ([#237](https://github.com/NobuData/ouroboros/issues/237)) lands; the
 *   contract has no key for it, so the footer never says it (decision **I8**).
 * - **A flat line at zero.** A range with nothing in it is an empty state, never a chart.
 */

import type { InsightsPage, InsightsRange } from "@/app/api/insights";
import type { TimeSeriesAnnotation, TimeSeriesGuide, TimeSeriesPoint } from "@/app/charts";
import { moneyOfCents, tokenCount } from "@/app/format";

/** The page's three series, as served. */
type InsightsSeries = InsightsPage["series"];

/** The throughput card's series, as served. */
export type ThroughputSeries = InsightsSeries["throughput"];

/** The daily-cost card's series, as served. */
export type CostSeries = InsightsSeries["cost"];

/** One day of the throughput series. */
export type ThroughputDay = ThroughputSeries["points"][number];

/** One day of the cost series. */
export type CostDay = CostSeries["points"][number];

/* ------------------------------------------------------------------ days and windows */

/** Month abbreviations in calendar order — written out, as `app/format.ts` refuses `Intl`. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A UTC calendar day as the axis and the tooltip spell it.
 *
 * Read straight off the string rather than through `Date`, so no reader's time zone can move a
 * day across midnight: the service's days are UTC days.
 *
 * @param day An ISO date — `2026-08-04`.
 * @returns `Aug 4`, or the string unchanged when it is not an ISO date.
 */
export function dayLabel(day: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(day);
  const month = match ? MONTHS[Number(match[1]) - 1] : undefined;

  return match && month ? `${month} ${Number(match[2])}` : day;
}

/**
 * The window a card covers — the mockup's tag, `Jul 10 – Aug 8`.
 *
 * @param window The page's window.
 * @returns The two days with an en dash between them.
 */
export function windowTag(window: InsightsPage["window"]): string {
  return `${dayLabel(window.from)} – ${dayLabel(window.to)}`;
}

/* ------------------------------------------------------------------ money */

/**
 * An amount that is a setting or an estimate rather than a measurement — a cap, a guide —
 * without the `.00` a whole dollar would carry: `$20`, `$600`, `$19.35`.
 *
 * @param cents The amount, in cents.
 * @returns It, as the mockup writes a round amount.
 */
export function roundMoney(cents: number): string {
  return moneyOfCents(cents).replace(/\.00$/, "");
}

/**
 * An estimate, to the dollar — the projection's `$571`. Writing cents would claim a precision a
 * linear extrapolation does not have.
 *
 * @param cents The amount, in cents.
 * @returns It, to the whole dollar.
 */
export function wholeDollars(cents: number): string {
  return roundMoney(Math.round(cents / 100) * 100);
}

/* ------------------------------------------------------------------ the empty state */

/** What a card draws instead of a chart: a heading naming what is not there, and why. */
export interface SeriesEmpty {
  /** What is not there. */
  readonly title: string;
  /** What will fill it. */
  readonly note: string;
}

/* ------------------------------------------------------------------ the throughput card */

/** The throughput card's empty state — a range nothing merged in. */
export const NO_THROUGHPUT: SeriesEmpty = {
  title: "No PRs merged in this range.",
  note: "The chart draws once a loop's pull request merges.",
};

/** The throughput card, ready to draw. */
export interface ThroughputView {
  /** The card's heading — `Merged PRs per day · 30d`. */
  readonly title: string;
  /** The chart's points, or `null` for the empty state. */
  readonly points: readonly TimeSeriesPoint[] | null;
  /** The chart's accessible name: what it shows and where it ends. */
  readonly label: string;
}

/**
 * How many of something, pluralized — `1 intervention`, `2 interventions`.
 *
 * @param count How many.
 * @param noun The singular.
 * @returns The count and the noun.
 */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * A throughput day's tooltip detail — mockup 15's `6 merged · $9.12 · 1 intervention`.
 *
 * The cost fragment is **omitted** on a day with no priced spend, never written `$0.00`: an
 * unpriced workspace's tooltip is `6 merged · 1 intervention`, and still useful.
 *
 * @param day The day.
 * @returns The detail after the date.
 */
export function throughputMeta(day: ThroughputDay): string {
  const cost = day.costCents === undefined ? [] : [moneyOfCents(day.costCents)];

  return [`${day.mergedPrs} merged`, ...cost, counted(day.interventions, "intervention")].join(" · ");
}

/**
 * The throughput card.
 *
 * @param series The throughput series.
 * @param range The window the page shows.
 * @returns The heading, the points — `null` when nothing merged in the range — and the name.
 */
export function throughputView(series: ThroughputSeries, range: InsightsRange): ThroughputView {
  const title = `Merged PRs per day · ${range}`;
  const last = series.points.at(-1);

  if (last === undefined || series.points.every((day) => day.mergedPrs === 0)) {
    return { title, points: null, label: `Merged PRs per day, last ${range}: none merged` };
  }

  return {
    title,
    points: series.points.map((day) => ({
      label: dayLabel(day.day),
      value: day.mergedPrs,
      meta: throughputMeta(day),
    })),
    label: `Merged PRs per day, last ${range}, ending at ${last.mergedPrs} per day`,
  };
}

/* ------------------------------------------------------------------ the daily cost card */

/** The cost card's heading, verbatim from the mockup. */
export const COST_TITLE = "Daily cost · all providers";

/** The cost card's empty state over a range with no usage at all. */
export const NO_USAGE: SeriesEmpty = {
  title: "No usage in this range.",
  note: "Daily cost draws once loops spend tokens.",
};

/** The empty state's title over a range whose usage no price covers. */
export const NO_PRICED_USAGE = "No priced usage in this range.";

/**
 * The empty state over a range whose usage no price covers: what was used, and why there is no
 * cost to draw — never a line at `$0.00`.
 *
 * @param tokens The tokens used in the range.
 * @returns The empty state.
 */
export function unpricedUsage(tokens: number): SeriesEmpty {
  return {
    title: NO_PRICED_USAGE,
    note: `${tokenCount(tokens)} tokens were used, and no provider price covers them, so there is no cost to draw.`,
  };
}

/** What the tooltip says of a day in a priced range that had no priced spend. */
export const NO_PRICED_SPEND = "no priced spend";

/**
 * The method the projection names in its tooltip, so nobody mistakes it for a forecast.
 *
 * @param projection The projection, as served.
 * @returns `Linear to date: $340.00 spent over the first 18 of 30 days of this month, scaled to the whole month — not a forecast.`
 */
export function projectionMethod(projection: NonNullable<CostSeries["projection"]>): string {
  return (
    `Linear to date: ${moneyOfCents(projection.monthToDateCents)} spent over the first ` +
    `${projection.daysElapsed} of ${projection.daysInMonth} days of this month, scaled to the ` +
    "whole month — not a forecast."
  );
}

/** The projection footer: its lead-in, the figures after it, and the method its tooltip names. */
export interface ProjectionView {
  /** The lead-in that carries the method tooltip — `Projected month`. */
  readonly lead: string;
  /** The rest of the sentence — `: $571 of $600 cap.`, or `: $571.` with no cap. */
  readonly figures: string;
  /** The method, in words. */
  readonly method: string;
}

/** The footer's lead-in, verbatim from the mockup. */
export const PROJECTED_MONTH = "Projected month";

/**
 * The projection footer — mockup 15's `Projected month: $571 of $600 cap.`
 *
 * The cap is named only when there is one. The mockup's `· alerts fire at 90%` is not written:
 * see the module note — it waits on #237, and the contract has no key for it.
 *
 * @param series The cost series.
 * @returns The footer, or `null` with no projection to state.
 */
export function projectionView(series: CostSeries): ProjectionView | null {
  const { projection, budget } = series;

  if (projection === undefined) return null;

  const cap = budget === undefined ? "" : ` of ${roundMoney(budget.monthlyCapCents)} cap`;

  return {
    lead: PROJECTED_MONTH,
    figures: `: ${wholeDollars(projection.projectedCents)}${cap}.`,
    method: projectionMethod(projection),
  };
}

/** The daily-cost card, ready to draw. */
export interface CostView {
  /** The chart's points — none when the card is {@link CostView.empty}. */
  readonly points: readonly TimeSeriesPoint[];
  /** What to draw instead of the chart, or `null` when there is a chart. */
  readonly empty: SeriesEmpty | null;
  /** The chart's accessible name. */
  readonly label: string;
  /** The dashed budget guide — only from a real provider cap. */
  readonly guide: TimeSeriesGuide | undefined;
  /** The spike's dot and label — the bare value; nothing attributes it. */
  readonly annotation: TimeSeriesAnnotation | undefined;
  /** The footer, or `null` with no projection. */
  readonly projection: ProjectionView | null;
}

/**
 * The guide's label — mockup 15's `$20 budget`.
 *
 * @param dailyCents The cap over the current month's days.
 * @returns The label.
 */
export function budgetLabel(dailyCents: number): string {
  return `${roundMoney(dailyCents)} budget`;
}

/**
 * The spike's label — the bare amount.
 *
 * The mockup's `— Zephyr migration spike` is an attribution, and nothing in the contract makes
 * one: writing a cause the data does not support would be the page inventing causation.
 *
 * @param spike The spike, as served.
 * @returns `$31.40`.
 */
export function spikeLabel(spike: NonNullable<CostSeries["spike"]>): string {
  return moneyOfCents(spike.costCents);
}

/**
 * A cost day as the chart plots it — its priced spend, or zero on a day without any, with the
 * tooltip saying which so a `$0.00` is never claimed for spend that was simply not priced.
 *
 * @param day The day.
 * @returns The point.
 */
function costPoint(day: CostDay): TimeSeriesPoint {
  const label = dayLabel(day.day);

  if (day.costCents !== undefined) return { label, value: day.costCents };

  const used = day.tokens > 0 ? ` · ${tokenCount(day.tokens)} tokens` : "";

  return { label, value: 0, meta: `${NO_PRICED_SPEND}${used}` };
}

/**
 * The daily-cost card.
 *
 * - With no priced day in the range there is no chart: an empty state says whether nothing was
 *   used or what was used went unpriced.
 * - The guide is drawn only from `budget`, the real provider caps.
 * - The spike is annotated with its bare value, and not at all when it is the last day — the
 *   endpoint's label already says that figure.
 *
 * @param series The cost series.
 * @param range The window the page shows.
 * @returns What the card draws.
 */
export function costView(series: CostSeries, range: InsightsRange): CostView {
  const projection = projectionView(series);
  const last = series.points.at(-1);

  if (last === undefined || series.points.every((day) => day.costCents === undefined)) {
    const tokens = series.points.reduce((sum, day) => sum + day.tokens, 0);

    return {
      points: [],
      empty: tokens > 0 ? unpricedUsage(tokens) : NO_USAGE,
      label: `Daily cost across all providers, last ${range}: nothing priced`,
      guide: undefined,
      annotation: undefined,
      projection,
    };
  }

  const { budget, spike } = series;
  const spikeIndex = spike ? series.points.findIndex((day) => day.day === spike.day) : -1;
  const annotated = spike && spikeIndex >= 0 && spikeIndex < series.points.length - 1;
  const spikeClause =
    spike && spikeIndex >= 0 ? `, with a ${spikeLabel(spike)} spike on ${dayLabel(spike.day)}` : "";
  const ending =
    last.costCents === undefined ? `with ${NO_PRICED_SPEND}` : `at ${moneyOfCents(last.costCents)}`;

  return {
    points: series.points.map(costPoint),
    empty: null,
    label: `Daily cost across all providers, last ${range}, ending ${ending}${spikeClause}`,
    guide: budget ? { value: budget.dailyCents, label: budgetLabel(budget.dailyCents) } : undefined,
    annotation: annotated ? { index: spikeIndex, label: spikeLabel(spike) } : undefined,
    projection,
  };
}
