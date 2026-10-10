/**
 * The arithmetic of a telemetry reading (CL.6,
 * [#619](https://github.com/NobuData/ouroboros/issues/619)): a sample's median and spread, and the
 * signed difference between two readings. Pure, and deliberately small — a cited number is only
 * evidence if a reader can redo it by hand.
 */

/** How many decimal places a derived figure keeps. */
const PLACES = 4;

/**
 * Round a derived figure, so two runs of the same query print the same digits.
 *
 * @param value - The figure.
 * @returns It, to four decimal places.
 */
export function round(value: number): number {
  const scale = 10 ** PLACES;

  return Math.round(value * scale) / scale;
}

/**
 * The value at a quantile of an ascending sample, interpolating between neighbours — the rule
 * PostgreSQL's `percentile_cont` uses, so a figure computed here and one computed in SQL agree.
 *
 * @param sorted - The sample, ascending and non-empty.
 * @param q - The quantile, 0 to 1.
 * @returns The value.
 */
export function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const below = Math.floor(position);
  const above = Math.ceil(position);

  return sorted[below] + (sorted[above] - sorted[below]) * (position - below);
}

/** A sample, summarised. */
export interface SampleSummary {
  /** How many values. */
  readonly n: number;
  /** The median. */
  readonly median: number;
  /** The interquartile range — the 75th percentile less the 25th. */
  readonly spread: number;
  /** The smallest value. */
  readonly min: number;
  /** The largest value. */
  readonly max: number;
}

/**
 * Summarise a sample.
 *
 * @param values - The values, in any order.
 * @returns Its count, median, interquartile range and extremes — or `null` for an empty sample:
 *   nothing was measured, and nothing is not zero.
 */
export function summarize(values: readonly number[]): SampleSummary | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);

  return {
    n: sorted.length,
    median: round(quantile(sorted, 0.5)),
    spread: round(quantile(sorted, 0.75) - quantile(sorted, 0.25)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

/** The signed difference between two readings. */
export interface Delta {
  /** `b − a`, in the readings' unit. Positive when the later window is higher. */
  readonly delta: number;
  /** The same as a percentage of `a`; `null` when `a` is zero and no percentage exists. */
  readonly deltaPct: number | null;
}

/**
 * The signed difference between two readings of one metric.
 *
 * @param a - The first window's value — the baseline of the comparison.
 * @param b - The second window's value.
 * @returns `b − a`, and the same relative to `a`.
 */
export function deltaOf(a: number, b: number): Delta {
  const delta = round(b - a);

  return { delta, deltaPct: a === 0 ? null : round(((b - a) / Math.abs(a)) * 100) };
}

/**
 * A signed figure as a citation prints it.
 *
 * @param value - The figure.
 * @param unit - Its unit; `%` is written tight, anything else after a space.
 * @returns `+14%`, `−0.3%`, `+230 ms`, `+2.9 pts`, `0 ms`.
 */
export function signed(value: number, unit: string): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";

  return `${sign}${String(Math.abs(value))}${unit === "%" ? "%" : ` ${unit}`}`;
}
