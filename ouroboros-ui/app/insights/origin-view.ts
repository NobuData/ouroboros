/**
 * What the Insights page says about data origin (DJ.3, [#1316](https://github.com/NobuData/ouroboros/issues/1316)).
 *
 * The page reads one origin at a time — live unless the reader chose another — and `ouroboros-rest`
 * answers which origins the workspace holds (`originsPresent`). From those two this module decides
 * the address, the badges every card carries and the heading for a week with no data. Value-only,
 * so the store, the cards and the tests read one table.
 */

import type { InsightsPage, InsightsRange } from "@/app/api/insights";
import { DEFAULT_ORIGIN, type DataOrigin, ORIGIN_PARAM, type OriginFilter } from "@/app/origin/origin";

import { DEFAULT_RANGE, RANGE_PARAM } from "./range";

/**
 * The search part of the page's address for a range and an origin — each left out at its default,
 * so plain `/insights` is 30 days of live data.
 *
 * @param range The range.
 * @param origin The origin.
 * @returns `""`, or `?range=7d`, `?origin=seeded`, `?range=7d&origin=all`.
 */
export function insightsSearch(range: InsightsRange, origin: OriginFilter): string {
  const params = new URLSearchParams();

  if (range !== DEFAULT_RANGE) params.set(RANGE_PARAM, range);
  if (origin !== DEFAULT_ORIGIN) params.set(ORIGIN_PARAM, origin);

  const search = params.toString();

  return search === "" ? "" : `?${search}`;
}

/**
 * The origin badges every card carries: the non-live origins the shown figures are computed from.
 *
 * - **Live** — none: live is the default reading and needs no label.
 * - **Demo data or simulated** — that origin's badge, when the workspace holds any of it.
 * - **All origins** — one badge per non-live origin the figures sum.
 *
 * @param page The page on screen, or null before the first read.
 * @param origin The origin the page shows.
 * @returns The origins to badge, in the service's order; empty for none.
 */
export function insightsBadges(page: InsightsPage | null, origin: OriginFilter): DataOrigin[] {
  if (page === null || origin === "live") return [];

  return page.originsPresent.filter(
    (present) => present !== "live" && (origin === "all" || present === origin),
  );
}

/** The heading over a week with no data of the shown origin — never a claim that nothing merged. */
export const NO_CLOSED_PR: Readonly<Record<OriginFilter, string>> = {
  live: "No live loop closed a pull request this week.",
  seeded: "No demo loop closed a pull request this week.",
  simulated: "No simulated loop closed a pull request this week.",
  all: "No loop closed a pull request this week.",
};
