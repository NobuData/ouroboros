/**
 * What one tick does for one family — the scheduling rules as a pure function (BI.2,
 * [#433](https://github.com/NobuData/ouroboros/issues/433)).
 *
 * Every tick (hourly by default) does up to three things for each (workspace, family):
 *
 *   1. **Start a backfill when one is due.** A family that has never been filled backfills its
 *      horizon (`OURO_INSIGHTS_ROLLUP_BACKFILL_DAYS`, ending yesterday). A family whose last
 *      complete day is before yesterday — the first tick after UTC midnight, or the first after an
 *      outage — **consolidates**: it re-fills the trailing window
 *      (`OURO_INSIGHTS_ROLLUP_CONSOLIDATE_DAYS`) plus any gap since the last fill, bounded by the
 *      horizon. That is the nightly consolidation: late-arriving data (a sync that ran late, a
 *      revert that landed days after its merge) reaches the days it belongs to. A backfill already
 *      in progress is left to finish.
 *   2. **Step the backfill** by at most `OURO_INSIGHTS_ROLLUP_DAYS_PER_TICK` days from its cursor.
 *      Each day commits with its cursor move, so an interruption loses only the day in flight.
 *   3. **Fill today** — the hourly incremental tail. Today is never "filled" in the bookkeeping
 *      sense: `last_filled_day` only ever names a day that is over.
 */

import { addDays, maxDay, minDay } from "./rollup.days";
import type { Day } from "./rollup.types";

/** A family's bookkeeping, as `metric_rollup_state` holds it. */
export interface FamilyState {
  readonly lastFilledDay: Day | null;
  readonly backfillCursor: Day | null;
  readonly backfillUntil: Day | null;
}

/** The knobs, from the environment. */
export interface PlanLimits {
  /** How far back a first fill reaches, and the most any consolidation reaches. */
  readonly backfillDays: number;
  /** The trailing window the nightly consolidation re-fills. */
  readonly consolidateDays: number;
}

/**
 * The backfill a tick should start, if any.
 *
 * @param state - The family's bookkeeping, or undefined when it has none yet.
 * @param today - The current UTC day.
 * @param limits - The horizon and the consolidation window.
 * @returns `[from, until]` to backfill (inclusive), or undefined when none is due.
 */
export function backfillDue(
  state: FamilyState | undefined,
  today: Day,
  limits: PlanLimits,
): { from: Day; until: Day } | undefined {
  const yesterday = addDays(today, -1);
  const horizon = addDays(today, -limits.backfillDays);

  if (state?.backfillCursor != null) {
    return undefined;
  }

  if (state?.lastFilledDay == null) {
    return { from: horizon, until: yesterday };
  }

  if (state.lastFilledDay >= yesterday) {
    return undefined;
  }

  const from = minDay(
    addDays(state.lastFilledDay, 1),
    addDays(yesterday, 1 - limits.consolidateDays),
  );

  return { from: maxDay(from, horizon), until: yesterday };
}
