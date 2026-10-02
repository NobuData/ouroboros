/**
 * How the Insights page's computed sentences print a number (BJ.2,
 * [#438](https://github.com/NobuData/ouroboros/issues/438)).
 *
 * The payload's values are numbers and the UI formats them. The **insight lines** are the
 * exception: each is a sentence computed on the server, so the figures inside it are printed
 * here — one place, so *"8m 20s"* in a line and the bar beside it can never be rounded two ways.
 *
 * The weekly email digest (BJ.4, #440) is the second exception: a mail has no client to format
 * for it, so every figure it prints goes through the printers below too.
 */

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

/** Number words for the counts a sentence spells out; anything else prints as digits. */
const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];

/**
 * A duration as the mockup prints one: `40s`, `2m`, `6m 04s`, `2h 10m`.
 *
 * Rounded to the second. Hours drop the seconds; a whole number of minutes or hours drops the
 * zero part (`2m`, not `2m 00s`).
 *
 * @param ms - Milliseconds, non-negative.
 * @returns The duration.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / SECOND_MS)) * SECOND_MS;
  const hours = Math.floor(total / HOUR_MS);
  const minutes = Math.floor((total % HOUR_MS) / MINUTE_MS);
  const seconds = Math.floor((total % MINUTE_MS) / SECOND_MS);

  if (hours > 0) {
    return minutes === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(minutes)}m`;
  }

  if (minutes > 0) {
    return seconds === 0
      ? `${String(minutes)}m`
      : `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
  }

  return `${String(seconds)}s`;
}

/**
 * A count in the mockup's compact form: `26.4k`, `126M`, `4.6M`, `980`.
 *
 * One decimal below ten of a unit and for thousands (`4.6M`, `26.4k`); none from ten millions up
 * (`126M`); a trailing `.0` is dropped.
 *
 * @param value - The count, non-negative.
 * @returns The compact form.
 */
export function formatCompact(value: number): string {
  const scaled = (divisor: number, suffix: string, decimals: number): string => {
    const text = (value / divisor).toFixed(decimals);

    return `${decimals > 0 && text.endsWith(".0") ? text.slice(0, -2) : text}${suffix}`;
  };

  if (value >= 1_000_000) {
    return scaled(1_000_000, "M", value >= 10_000_000 ? 0 : 1);
  }

  if (value >= 1_000) {
    return scaled(1_000, "k", 1);
  }

  return String(Math.round(value));
}

/**
 * A share as a percentage with as many decimals as it needs to not read as zero: `40%`,
 * `0.12%`, `31%`.
 *
 * @param numerator - The part.
 * @param denominator - The whole, positive.
 * @returns The percentage, without a sign of approximation.
 */
export function formatShare(numerator: number, denominator: number): string {
  const percent = (100 * numerator) / denominator;

  if (percent === 0 || percent >= 1) {
    return `${String(Math.round(percent))}%`;
  }

  return `${percent.toFixed(2)}%`;
}

/**
 * A small count as a sentence spells it: `five`, `12`.
 *
 * @param count - The count, a non-negative integer.
 * @returns The word below ten, the digits otherwise.
 */
export function formatCountWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

/** The units a figure can be in — the metric registry's. */
export type FigureUnit = "count" | "pct" | "duration_ms" | "cents" | "tokens";

/** What a figure with nothing to compute it from prints as. */
export const NO_FIGURE = "—";

/**
 * A count with thousands separators: `20`, `26,430`.
 *
 * @param value - The count.
 * @returns It, rounded to a whole number.
 */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/**
 * Cents as dollars: `$1.87`, `$31.40`, `$118`, `$1,204.50`.
 *
 * Rounded to the cent. A whole number of dollars drops the cents, as the mockup's `$118 this
 * week` does.
 *
 * @param cents - The amount, non-negative.
 * @returns The dollar figure.
 */
export function formatMoney(cents: number): string {
  const rounded = Math.round(cents);
  const digits = rounded % 100 === 0 ? 0 : 2;

  return `$${(rounded / 100).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/**
 * A stored percentage (0–100) as the page prints one: `92%`, `0.12%`.
 *
 * @param value - The percentage.
 * @returns It, with {@link formatShare}'s decimals.
 */
export function formatPercent(value: number): string {
  return formatShare(value, 100);
}

/**
 * A figure in its unit: `92%`, `14m 20s`, `$1.87`, `1.3M`, `20` — or `—` when there is nothing
 * to compute it from.
 *
 * @param value - The figure, or null.
 * @param unit - What it is in.
 * @returns The printed figure.
 */
export function formatFigure(value: number | null, unit: FigureUnit): string {
  if (value === null) {
    return NO_FIGURE;
  }

  switch (unit) {
    case "pct":
      return formatPercent(value);
    case "duration_ms":
      return formatDuration(value);
    case "cents":
      return formatMoney(value);
    case "tokens":
      return formatCompact(value);
    case "count":
      return formatCount(value);
  }
}

/**
 * How far a figure moved against the prior window, as the mockup's KPI cards print it:
 * `▲ 3pts`, `▼ 2m`, `▼ $0.41`, `▼ 5`.
 *
 * A percentage moves in points. The arrow is the direction of the number, not a judgement:
 * whether down is good is the caller's to say.
 *
 * @param delta - `value − prior` in `unit`, or null when either is unknown.
 * @param unit - What the figure is in.
 * @returns The move, or null when there is none to state — nothing to compare with, or a move
 *   too small to print.
 */
export function formatDelta(delta: number | null, unit: FigureUnit): string | null {
  if (delta === null || delta === 0) {
    return null;
  }

  const size = Math.abs(delta);
  let printed: string;

  if (unit === "pct") {
    // Whole points from one point up; a tenth below, so a 0.4-point move is not printed as 0.
    const points = size >= 1 ? String(Math.round(size)) : size.toFixed(1);

    printed = Number(points) === 0 ? "" : `${points}${points === "1" ? "pt" : "pts"}`;
  } else {
    printed = formatFigure(size, unit);
  }

  // A move that rounds away at print precision is not a move the reader can check.
  if (printed === "" || printed === formatFigure(0, unit)) {
    return null;
  }

  return `${delta > 0 ? "▲" : "▼"} ${printed}`;
}
