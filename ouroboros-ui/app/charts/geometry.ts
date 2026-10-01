/**
 * The arithmetic behind the Insights chart primitives
 * ([#442](https://github.com/NobuData/ouroboros/issues/442)) — pure, framework-free, and
 * tested on its own in `__tests__/charts/geometry.test.ts`.
 *
 * The components in this directory are hand-written SVG and CSS on purpose (decision **I4**):
 * the series are at most ninety points, and every distinctive detail of mockup 15 — sparse
 * ticks, a direct endpoint label, a dashed guide — is quicker to write than to coerce out of a
 * charting library. What that leaves to write is this file: where a value lands on the page.
 */

/** A point placed in the SVG's own coordinate system. */
export interface PlotPoint {
  /** Distance from the left edge, in viewBox units. */
  readonly x: number;
  /** Distance from the top edge, in viewBox units. */
  readonly y: number;
}

/** The box a time series is drawn inside, in viewBox units. */
export interface PlotFrame {
  /** The viewBox's width. */
  readonly width: number;
  /** The viewBox's height. */
  readonly height: number;
  /** The x of the first point; the last sits the same distance from the right edge. */
  readonly inset: number;
  /** The y the largest value in the domain is drawn at. Above it is room for labels. */
  readonly top: number;
  /** The y a value of zero is drawn at — the solid baseline. */
  readonly baseline: number;
}

/**
 * The frame mockup 15 draws its charts in, scaled to a viewBox.
 *
 * The throughput chart is `640 × 196` with the domain's top at `y = 40` and the baseline at
 * `y = 166`; its x-ticks sit below that. The ratios are kept rather than the numbers, so a
 * shorter chart (the daily cost card's `560 × 140`) keeps the same room for its labels.
 *
 * @param width The viewBox's width. Values below `40` are raised to `40`, the narrowest box
 *   that still has a plot inside its insets.
 * @param height The viewBox's height. Raised to `60` for the same reason.
 * @returns The frame.
 */
export function plotFrame(width: number, height: number): PlotFrame {
  const w = Math.max(40, width);
  const h = Math.max(60, height);

  return { width: w, height: h, inset: 10, top: Math.round(h * 0.2), baseline: h - 30 };
}

/**
 * The largest value the y axis has to reach.
 *
 * The series' own maximum, or the guide's if a guide is higher — a budget line drawn above
 * the plot would be a line nobody can see. A domain of nothing at all (an empty series, or
 * one of zeroes) is `1`, so that zero sits on the baseline instead of dividing by zero.
 *
 * @param values The series' values.
 * @param guide The guide line's value, if there is one.
 * @returns The top of the domain, always greater than zero.
 */
export function domainMax(values: readonly number[], guide?: number): number {
  const finite = values.filter(Number.isFinite);
  const max = Math.max(0, ...finite, guide !== undefined && Number.isFinite(guide) ? guide : 0);

  return max > 0 ? max : 1;
}

/**
 * The y a value is drawn at.
 *
 * @param value The value. Clamped to the domain, so a negative never drops below the baseline.
 * @param max The domain's top, from {@link domainMax}.
 * @param frame The frame.
 * @returns The y, in viewBox units.
 */
export function yOf(value: number, max: number, frame: PlotFrame): number {
  const clamped = Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : 0;

  return round(frame.baseline - (clamped / max) * (frame.baseline - frame.top));
}

/**
 * The x the i-th of `count` points is drawn at, spread evenly from inset to inset.
 *
 * A single point has nowhere to spread to and is drawn on the right, where the endpoint of a
 * longer series would be — it *is* the latest value.
 *
 * @param index The point's position in the series.
 * @param count How many points there are.
 * @param frame The frame.
 * @returns The x, in viewBox units.
 */
export function xOf(index: number, count: number, frame: PlotFrame): number {
  const right = frame.width - frame.inset;

  if (count <= 1) return right;

  return round(frame.inset + (index / (count - 1)) * (right - frame.inset));
}

/**
 * Every value of a series placed in the frame.
 *
 * @param values The series' values.
 * @param max The domain's top.
 * @param frame The frame.
 * @returns One point per value, in order.
 */
export function placePoints(
  values: readonly number[],
  max: number,
  frame: PlotFrame,
): readonly PlotPoint[] {
  return values.map((value, index) => ({
    x: xOf(index, values.length, frame),
    y: yOf(value, max, frame),
  }));
}

/**
 * The `points` attribute of the series' `<polyline>`.
 *
 * @param points The placed points.
 * @returns `x,y` pairs separated by spaces — `""` for an empty series.
 */
export function linePoints(points: readonly PlotPoint[]): string {
  return points.map(({ x, y }) => `${x},${y}`).join(" ");
}

/**
 * The `d` attribute of the area under the line: down to the baseline at both ends and closed.
 *
 * @param points The placed points.
 * @param frame The frame.
 * @returns The path, or `""` when there are fewer than two points — one point encloses no area.
 */
export function areaPath(points: readonly PlotPoint[], frame: PlotFrame): string {
  if (points.length < 2) return "";

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const line = points.map(({ x, y }) => `L${x},${y}`).join(" ");

  return `M${first.x},${frame.baseline} ${line} L${last.x},${frame.baseline} Z`;
}

/**
 * The y of each horizontal gridline, top first.
 *
 * Evenly spaced from the domain's top down to the baseline, which is drawn separately and
 * solid — mockup 15's throughput chart draws three dimmed lines over one solid one.
 *
 * @param count How many dimmed gridlines. Fewer than one draws none.
 * @param frame The frame.
 * @returns The y of each.
 */
export function gridlineYs(count: number, frame: PlotFrame): readonly number[] {
  const lines = Math.max(0, Math.floor(count));
  const step = (frame.baseline - frame.top) / Math.max(lines, 1);

  return Array.from({ length: lines }, (_, index) => round(frame.top + index * step));
}

/**
 * Which points carry an x-axis label: three of them, sparse, the last one always.
 *
 * Mockup 15 labels a thirty-day series at its third day, its middle and its end. That is the
 * default; a short series collapses to the indices it has.
 *
 * @param count How many points.
 * @returns The indices to label, ascending and unique.
 */
export function sparseTicks(count: number): readonly number[] {
  if (count <= 0) return [];

  const last = count - 1;
  const picks = [Math.round(last * 0.07), Math.round(last / 2), last];

  return [...new Set(picks)].sort((a, b) => a - b);
}

/**
 * How a tick label hangs off its point: the last one ends at its point so it never runs off
 * the right edge, the first starts at its point for the left edge's sake, the rest centre.
 *
 * @param index The labelled point.
 * @param count How many points.
 * @returns The SVG `text-anchor`.
 */
export function tickAnchor(index: number, count: number): "start" | "middle" | "end" {
  if (index === count - 1) return "end";
  if (index === 0) return "start";
  return "middle";
}

/**
 * A value as a fraction of the largest in its set — the width of an `.hbar`, the height of a
 * `.spark` bar.
 *
 * @param value The value. Negative and non-finite values are zero.
 * @param max The largest value in the set.
 * @returns A number from `0` to `1`; `0` whenever `max` is not positive.
 */
export function fractionOf(value: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(value)) return 0;

  return Math.min(Math.max(value / max, 0), 1);
}

/**
 * A fraction written as the percentage a custom property carries — `62.5%`.
 *
 * @param fraction From `0` to `1`.
 * @returns The percentage, to at most two decimals.
 */
export function percentProperty(fraction: number): string {
  return `${Math.round(fraction * 10000) / 100}%`;
}

/**
 * Round a coordinate to two decimals — sub-pixel enough, and short enough to read in markup.
 *
 * @param value The coordinate.
 * @returns It, rounded.
 */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
