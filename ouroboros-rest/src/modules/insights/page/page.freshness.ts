/**
 * How current the Insights page's rollups are (BK.6, [#447](https://github.com/NobuData/ouroboros/issues/447)).
 *
 * Every figure on the page is read from `metric_daily`, which #433's jobs fill hourly, one family
 * at a time, with a live tail for today. When a job has been failing, the page is drawn from days
 * that stopped moving — and a page that presents old numbers as current is the dishonesty the
 * rollup-lag banner exists to prevent. This turns the workspace's `metric_rollup_state` rows
 * into the one fact the banner needs: **through which day the figures run, and when they were
 * last filled**.
 *
 * Pure: the repository reads the rows, this decides what they mean.
 */

import { addDays, utcDay } from "../rollup/rollup.days";
import type { Day } from "../rollup/rollup.types";
import type { InsightsFreshness } from "./page.resources";

/** The workspace's rollup bookkeeping, summarized over every family. */
export interface FreshnessFacts {
  /** How many families have a bookkeeping row at all. */
  readonly families: number;
  /** How many of them have filled at least one complete day. */
  readonly filledFamilies: number;
  /** The earliest `last_filled_day` among the families that have one, or null when none has. */
  readonly earliestFilledDay: Day | null;
  /** The latest instant a family's run succeeded, or null when none has. */
  readonly lastSucceededAt: Date | null;
  /** Whether any family's latest run failed. */
  readonly failing: boolean;
}

/** A workspace no rollup job has touched yet. */
export const NO_FRESHNESS_FACTS: FreshnessFacts = Object.freeze({
  families: 0,
  filledFamilies: 0,
  earliestFilledDay: null,
  lastSucceededAt: null,
  failing: false,
});

/**
 * The page's freshness.
 *
 * - `filledThrough` is the **stalest** family's last complete day: the page is only as current as
 *   its oldest figure, so the earliest day is the honest one to name.
 * - `behind` is true when that day is before yesterday (UTC) — a whole day the hourly job should
 *   have closed is missing — or when some families have filled and others never have. A
 *   workspace nothing has filled yet is **not** behind: it is cold, and its cards say *not
 *   enough data to measure* on their own.
 * - `failing` passes the latest runs' outcome through, so the banner can say the job is failing
 *   rather than merely slow.
 *
 * @param facts - The summarized bookkeeping.
 * @param now - The page's one instant.
 * @returns The freshness the payload carries.
 */
export function freshnessOf(facts: FreshnessFacts, now: Date): InsightsFreshness {
  const yesterday = addDays(utcDay(now), -1);
  const partlyFilled = facts.filledFamilies > 0 && facts.filledFamilies < facts.families;
  const stale = facts.earliestFilledDay !== null && facts.earliestFilledDay < yesterday;

  return {
    filledThrough: facts.earliestFilledDay,
    lastFilledAt: facts.lastSucceededAt === null ? null : facts.lastSucceededAt.toISOString(),
    behind: stale || partlyFilled,
    failing: facts.failing,
  };
}
