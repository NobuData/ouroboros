/**
 * Range resolution for the windowed metrics service (BJ.1,
 * [#437](https://github.com/NobuData/ouroboros/issues/437), decision **I3**). Every surface that
 * asks "what is metric X over range R, and what was it before" gets the same boundaries from here.
 *
 * ## The rules, stated once
 *
 *   * **Days are UTC calendar days.** The daily grain (`metric_daily.day`, V078) buckets every
 *     source instant by `(at time zone 'UTC')::date`, so no other zone can be honoured without
 *     re-bucketing the grain. The caller's clock offset does not matter: an instant is an instant,
 *     and `2026-09-01T23:30-05:00` and `2026-09-02T04:30Z` both resolve to the UTC day
 *     `2026-09-02`. A per-workspace timezone would change this file and the grain together.
 *   * **A window of N days is N whole UTC days ending with today**, today included:
 *     `[today − (N−1), today]`. Today is partial — it holds what has happened so far — and is read
 *     from the live tail, never from the rollup (see `metrics.service.ts`).
 *   * **The prior window is the N UTC days immediately before**: `[today − (2N−1), today − N]`.
 *     Equal length, no gap and no overlap, so `value − prior` compares like with like. Calendar
 *     weeks and months are not boundaries: a 30-day window that crosses a month end is still thirty
 *     consecutive days, and a 7-day window does not snap to Monday.
 *   * **The rollup scan never reads today**: it covers `[priorFrom, today − 1]`. Today comes only
 *     from the tail, so a partially filled hourly row cannot be counted beside the live figure.
 */

import { addDays, utcDay } from "../rollup/rollup.days";
import type { Day } from "../rollup/rollup.types";

/** The ranges the Insights segment offers — mockup 15's `7d · 30d · 90d`. Custom is BL.3's. */
export const METRIC_RANGES = ["7d", "30d", "90d"] as const;

/** One of {@link METRIC_RANGES}. */
export type MetricRange = (typeof METRIC_RANGES)[number];

/** How many UTC days each range spans. */
const RANGE_DAYS: Readonly<Record<MetricRange, number>> = { "7d": 7, "30d": 30, "90d": 90 };

/** An inclusive span of UTC days. */
export interface DaySpan {
  /** The first day. */
  readonly from: Day;
  /** The last day, inclusive. */
  readonly to: Day;
}

/** Every boundary one window request is measured between. */
export interface ResolvedWindow {
  /** The range asked for. */
  readonly range: MetricRange;
  /** How many days it spans. */
  readonly days: number;
  /** Today's UTC day — the live tail's day and the window's last. */
  readonly today: Day;
  /** The window: N days ending with today. */
  readonly current: DaySpan;
  /** The N days before {@link ResolvedWindow.current}. */
  readonly prior: DaySpan;
  /** The stored days the rollup scan reads: the prior window's start to yesterday. */
  readonly scan: DaySpan;
}

/**
 * Whether a value is one of {@link METRIC_RANGES}.
 *
 * @param value - The candidate, typically a query parameter.
 * @returns True for `7d`, `30d` or `90d`.
 */
export function isMetricRange(value: unknown): value is MetricRange {
  return typeof value === "string" && (METRIC_RANGES as readonly string[]).includes(value);
}

/**
 * How many days a range spans.
 *
 * @param range - The range.
 * @returns 7, 30 or 90.
 */
export function rangeDays(range: MetricRange): number {
  return RANGE_DAYS[range];
}

/**
 * Resolve a range against an instant, using the rules in this file's header.
 *
 * @param range - The range.
 * @param now - The instant the request is answered at, in any offset.
 * @returns The window, its prior and the scan span.
 * @throws {RangeError} When `now` is not a valid date.
 */
export function resolveWindow(range: MetricRange, now: Date): ResolvedWindow {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("a metrics window needs a valid instant");
  }

  const days = rangeDays(range);
  const today = utcDay(now);
  const current = { from: addDays(today, -(days - 1)), to: today };
  const prior = { from: addDays(today, -(2 * days - 1)), to: addDays(today, -days) };

  return { range, days, today, current, prior, scan: { from: prior.from, to: addDays(today, -1) } };
}

/**
 * Every day of a span, in order.
 *
 * @param span - The span.
 * @returns `from`, `from + 1`, …, `to`.
 */
export function daysOf(span: DaySpan): Day[] {
  const out: Day[] = [];

  for (let day = span.from; day <= span.to; day = addDays(day, 1)) {
    out.push(day);
  }

  return out;
}
