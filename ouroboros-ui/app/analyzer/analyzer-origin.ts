/**
 * Which data origin the analyzer page reads (#2022, after DJ.3
 * [#1316](https://github.com/NobuData/ouroboros/issues/1316)).
 *
 * The page takes the dashboard's `?origin=` and the reader's remembered choice
 * (`app/origin/origin.ts`), with one difference: **an analysis reads one origin**. The service
 * refuses `all` — a change-point found in a curve that is half simulator is not a finding about
 * anything — so `all` here reads `live`, the same as no choice at all.
 */

import type { DataOrigin, OriginFilter } from "@/app/origin/origin";

/** The query parameter the analyzer's poll carries the origin in — the service's own name. */
export const ANALYZER_ORIGIN_PARAM = "origin";

/** Every origin an analysis may read. */
const ANALYZER_ORIGINS: readonly DataOrigin[] = ["live", "simulated", "seeded"];

/**
 * The origin the page reads for a filter.
 *
 * @param filter The page's origin filter, or a raw query value.
 * @returns That origin; `live` for `all`, for nothing, and for anything unrecognized.
 */
export function analyzerOrigin(
  filter: OriginFilter | string | null | undefined,
): DataOrigin {
  return ANALYZER_ORIGINS.find((origin) => origin === filter) ?? "live";
}

/**
 * The service's query for one repository and origin. `live` is left out, so a live read asks
 * exactly what it asked before the parameter existed.
 *
 * @param repo The repository, `owner/name`.
 * @param origin The origin to read.
 * @returns `{repo}` or `{repo, origin}`.
 */
export function analyzerQuery(
  repo: string,
  origin: DataOrigin = "live",
): { repo: string; origin?: DataOrigin } {
  return origin === "live" ? { repo } : { repo, origin };
}
