/**
 * UTC calendar-day arithmetic for the rollup jobs (BI.2, [#433](https://github.com/NobuData/ouroboros/issues/433)).
 *
 * Every extractor buckets by the UTC day (V078's header): a day is `YYYY-MM-DD`, its instants are
 * `[00:00Z, next 00:00Z)`. Kept as strings rather than `Date`s because that is what the grain's
 * `day` column, the cursor columns and a log line all say, and because string comparison of
 * `YYYY-MM-DD` is date order.
 */

import type { Day } from "./rollup.types";

/** Milliseconds in a UTC day — no leap seconds in POSIX time. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The shape {@link isDay} accepts. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a string is a real calendar day in `YYYY-MM-DD` form.
 *
 * @param value - The candidate.
 * @returns True for `2026-08-04`; false for `2026-02-30`, `2026-8-4` or anything else.
 */
export function isDay(value: string): value is Day {
  if (!DAY_PATTERN.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  // An impossible month is an invalid date; an impossible day of a real month rolls over.
  return !Number.isNaN(date.getTime()) && utcDay(date) === value;
}

/**
 * The UTC day an instant falls on.
 *
 * @param at - The instant.
 * @returns Its `YYYY-MM-DD`, in UTC.
 */
export function utcDay(at: Date): Day {
  return at.toISOString().slice(0, 10);
}

/**
 * A day moved by a whole number of days.
 *
 * @param day - The start.
 * @param days - How far; negative moves back.
 * @returns The day that many days away.
 */
export function addDays(day: Day, days: number): Day {
  return utcDay(new Date(dayStart(day).getTime() + days * DAY_MS));
}

/**
 * The first instant of a day.
 *
 * @param day - The day.
 * @returns `day`T00:00:00.000Z.
 */
export function dayStart(day: Day): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * The half-open instant range a day covers — what every extractor's `where` reads.
 *
 * @param day - The day.
 * @returns `[from, to)`: the day's midnight and the next.
 */
export function dayBounds(day: Day): { from: Date; to: Date } {
  const from = dayStart(day);

  return { from, to: new Date(from.getTime() + DAY_MS) };
}

/**
 * The earlier of two days.
 *
 * @param a - One day.
 * @param b - Another.
 * @returns Whichever comes first.
 */
export function minDay(a: Day, b: Day): Day {
  return a <= b ? a : b;
}

/**
 * The later of two days.
 *
 * @param a - One day.
 * @param b - Another.
 * @returns Whichever comes last.
 */
export function maxDay(a: Day, b: Day): Day {
  return a >= b ? a : b;
}
