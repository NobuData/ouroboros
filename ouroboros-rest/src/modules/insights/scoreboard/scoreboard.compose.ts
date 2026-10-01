/**
 * The model scoreboard's arithmetic (BJ.3, [#439](https://github.com/NobuData/ouroboros/issues/439)):
 * pure functions from one window's tallies, and its prior window's, to rows.
 *
 * | column        | rule                                                                     |
 * | ------------- | ------------------------------------------------------------------------ |
 * | untouched %   | `untouched ÷ merged × 100` — I6's predicate, counted by the statement    |
 * | `$ / success` | priced cents ÷ merged when every token was priced; tokens ÷ merged else  |
 * | trend         | current rate − the same row's prior-window rate: up, down or flat        |
 * | role          | hop 1 is the primary; a later hop is a fallback                          |
 * | sample        | merged; below {@link SCOREBOARD_MIN_SAMPLE} the row is badged, not hidden |
 */

import type {
  ScoreboardCost,
  ScoreboardKey,
  ScoreboardRole,
  ScoreboardRow,
  ScoreboardTally,
  ScoreboardTrend,
} from "./scoreboard.types";

/**
 * Merges a row needs before its rate reads as more than noise. Below it the row carries
 * `lowSample` — never dropped (that hides information) and never shown bare (that misleads).
 * `scoreboard_merged`'s caveat (V082) states the same number.
 */
export const SCOREBOARD_MIN_SAMPLE = 10;

/**
 * A row's identity as a map key.
 *
 * @param key - Task kind, model and hop.
 * @returns A string unique to the triple.
 */
export function keyOf(key: ScoreboardKey): string {
  return JSON.stringify([key.taskKind, key.model, key.hop]);
}

/**
 * The hop's role.
 *
 * @param hop - The 1-based place in the resolved chain.
 * @returns `primary` for the first hop, `fallback` for any later one.
 */
export function roleOf(hop: number): ScoreboardRole {
  return hop <= 1 ? "primary" : "fallback";
}

/**
 * The untouched rate.
 *
 * @param tally - The row's counts in one window, or undefined when the row had none.
 * @returns 0–100, or null with no merges to divide by.
 */
export function untouchedRateOf(
  tally: Pick<ScoreboardTally, "merged" | "untouched"> | undefined,
): number | null {
  if (tally === undefined || tally.merged === 0) {
    return null;
  }

  return (tally.untouched / tally.merged) * 100;
}

/**
 * The `$ / success` column.
 *
 * @param tally - The row's window.
 * @returns Dollars only when every token was priced; tokens when any was not; `none` without usage.
 */
export function costOf(tally: ScoreboardTally): ScoreboardCost {
  const perSuccess = (total: number): number | null =>
    tally.merged === 0 ? null : total / tally.merged;

  if (tally.unpricedTokens > 0) {
    return {
      pricing: "unpriced",
      tokens: tally.tokens,
      unpricedTokens: tally.unpricedTokens,
      tokensPerSuccess: perSuccess(tally.tokens),
    };
  }

  if (tally.costCents !== null) {
    return {
      pricing: "priced",
      cents: tally.costCents,
      centsPerSuccess: perSuccess(tally.costCents),
    };
  }

  return { pricing: "none" };
}

/**
 * The trend arrow.
 *
 * @param current - This window's untouched rate.
 * @param prior - The prior window's, for the same row.
 * @returns `up`/`down` by the sign of the difference; `flat` when equal or either side is null.
 */
export function trendOf(current: number | null, prior: number | null): ScoreboardTrend {
  const delta = current === null || prior === null ? null : current - prior;
  const direction = delta === null || delta === 0 ? "flat" : delta > 0 ? "up" : "down";

  return { direction, prior, delta };
}

/**
 * The scoreboard's order: the busiest task kind first (most merges across its rows), its rows
 * together — primary before fallback, then the busier model — so a fallback sits under its primary.
 *
 * @param tallies - The window's tallies.
 * @returns A comparator over them.
 */
function busiestFirst(
  tallies: readonly ScoreboardTally[],
): (a: ScoreboardTally, b: ScoreboardTally) => number {
  const merges = new Map<string, number>();

  for (const tally of tallies) {
    merges.set(tally.taskKind, (merges.get(tally.taskKind) ?? 0) + tally.merged);
  }

  const busy = (tally: ScoreboardTally): number => merges.get(tally.taskKind) ?? 0;

  return (a, b) =>
    busy(b) - busy(a) ||
    a.taskKind.localeCompare(b.taskKind) ||
    a.hop - b.hop ||
    b.merged - a.merged ||
    a.model.localeCompare(b.model);
}

/**
 * Every row of the scoreboard.
 *
 * A row exists for each tally in the current window — including one with usage and no merge,
 * which is a model that has not yet succeeded and is shown as such. A row with only prior-window
 * activity is not in this window and has no row.
 *
 * @param current - This window's tallies.
 * @param prior - The prior window's tallies.
 * @param minSample - The low-sample threshold.
 * @returns The rows, busiest task kind first.
 */
export function composeRows(
  current: readonly ScoreboardTally[],
  prior: readonly ScoreboardTally[],
  minSample: number = SCOREBOARD_MIN_SAMPLE,
): ScoreboardRow[] {
  const priorByKey = new Map(prior.map((tally) => [keyOf(tally), tally]));

  return [...current].sort(busiestFirst(current)).map((tally) => {
    const untouchedRate = untouchedRateOf(tally);

    return {
      taskKind: tally.taskKind,
      model: tally.model,
      hop: tally.hop,
      role: roleOf(tally.hop),
      merged: tally.merged,
      untouched: tally.untouched,
      untouchedRate,
      cost: costOf(tally),
      trend: trendOf(untouchedRate, untouchedRateOf(priorByKey.get(keyOf(tally)))),
      lowSample: tally.merged < minSample,
    };
  });
}
