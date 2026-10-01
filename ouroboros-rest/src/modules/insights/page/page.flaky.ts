/**
 * The Insights page's flaky card (BJ.2, [#438](https://github.com/NobuData/ouroboros/issues/438)).
 *
 * Pure: the flakes plane's card cases in, rows out. A row's rate and its history are the case's
 * real occurrences — flaky ones over observed ones — and its trend is the window's second half
 * against its first. The context a row may carry (the rig it flaked on, the loop that showed it
 * fixed) is present only when the occurrences name it; otherwise the key is absent.
 */

import type { FlakeCardCase } from "../../flakes/flakes.resources";
import type { Day } from "../rollup/rollup.types";
import type { InsightsFlaky, InsightsFlakyCase } from "./page.resources";

/**
 * Flaky occurrences as a percentage of observed ones.
 *
 * @param flaky - Flaky occurrences.
 * @param observed - Observed occurrences.
 * @returns 0–100, or null when the case did not run.
 */
function rateOf(flaky: number, observed: number): number | null {
  return observed > 0 ? (100 * flaky) / observed : null;
}

/**
 * Whether a case flaked more in the window's second half than in its first.
 *
 * @param flaky - The case.
 * @param days - The window's days, oldest first.
 * @returns `flat` unless both halves ran and their rates differ.
 */
function trendOf(flaky: FlakeCardCase, days: readonly Day[]): InsightsFlakyCase["trend"] {
  const middle = days[Math.floor(days.length / 2)];
  const half = (later: boolean): number | null => {
    const inHalf = flaky.history.filter((day) => day.day >= middle === later);

    return rateOf(
      inHalf.reduce((total, day) => total + day.flaky, 0),
      inHalf.reduce((total, day) => total + day.observed, 0),
    );
  };
  const first = half(false);
  const second = half(true);

  if (first === null || second === null || first === second) {
    return "flat";
  }

  return second > first ? "rising" : "falling";
}

/**
 * The flaky card.
 *
 * @param cases - The flakes plane's cases for the window, highest score first.
 * @param days - The window's days, oldest first — the history has a point for each.
 * @returns The card's rows, in the order given.
 */
export function flakyOf(cases: readonly FlakeCardCase[], days: readonly Day[]): InsightsFlaky {
  return {
    cases: cases.map((flaky): InsightsFlakyCase => {
      const byDay = new Map(flaky.history.map((day) => [day.day, day]));

      return {
        caseKey: flaky.caseKey,
        name: flaky.name,
        suite: flaky.suite,
        repository: flaky.repository,
        state: flaky.state,
        ratePct: rateOf(flaky.flaky, flaky.observed),
        trend: trendOf(flaky, days),
        history: days.map((day) => {
          const on = byDay.get(day);

          return { day, ratePct: on === undefined ? null : rateOf(on.flaky, on.observed) };
        }),
        ...(flaky.platform === null ? {} : { platform: flaky.platform }),
        ...(flaky.resolvedBy === null ? {} : { resolvedBy: flaky.resolvedBy }),
      };
    }),
  };
}
