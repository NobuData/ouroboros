/**
 * How the Insights page's computed sentences print a number (BJ.2,
 * [#438](https://github.com/NobuData/ouroboros/issues/438)).
 *
 * The payload's values are numbers and the UI formats them. The **insight lines** are the
 * exception: each is a sentence computed on the server, so the figures inside it are printed
 * here — one place, so *"8m 20s"* in a line and the bar beside it can never be rounded two ways.
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
