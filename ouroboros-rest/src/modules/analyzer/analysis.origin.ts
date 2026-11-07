/**
 * Which data origin an analysis reads (#2022, after DJ.2
 * [#1315](https://github.com/NobuData/ouroboros/issues/1315)).
 *
 * **One analysis, one origin.** A run reads the builds, loops, test runs, waivers and rollups of
 * exactly one origin — `live` unless a person asks for another — and stores it
 * (`analysis_runs.origin`, V155), so every finding and suggestion it produces is of that origin
 * alone. There is no `all`: Insights may sum origins and mark the answer mixed, but a change-point
 * found in a curve that is half simulator is not a finding about anything.
 *
 * Scheduled and every-N runs are always {@link DEFAULT_ANALYSIS_ORIGIN}; only the page's *Run
 * analysis now* asks for another, the way the dashboard's `?origin=` does (DJ.3,
 * [#1316](https://github.com/NobuData/ouroboros/issues/1316)).
 */

import type { DataOrigin } from "../db/schema";

/** The origin an analysis reads when none is asked for: real runs only. */
export const DEFAULT_ANALYSIS_ORIGIN: DataOrigin = "live";

/**
 * The origin a request reads.
 *
 * @param origin - What was asked for, already validated as a {@link DataOrigin}, or undefined.
 * @returns It, or {@link DEFAULT_ANALYSIS_ORIGIN} when nothing was asked for.
 */
export function analysisOrigin(origin: DataOrigin | undefined): DataOrigin {
  return origin ?? DEFAULT_ANALYSIS_ORIGIN;
}
