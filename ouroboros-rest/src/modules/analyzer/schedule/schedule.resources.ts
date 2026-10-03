/**
 * What the Build Analyzer's schedule routes answer (BW.1,
 * [#516](https://github.com/NobuData/ouroboros/issues/516)) — mockup 18's
 * **Schedule: weekly + every 50 builds ▾** and the editor behind it.
 */

import { DEFAULT_BUDGET } from "../corpus/corpus.manifest";
import type { AnalysisScheduleRow } from "../analysis.repository";

/** A repository's analysis schedule. */
export interface AnalysisScheduleResource {
  repo: string;
  /** False when no schedule was ever saved, and the values below are V080's defaults. */
  saved: boolean;
  enabled: boolean;
  weeklyEnabled: boolean;
  /** ISO day of week, 1 = Monday; kept while the weekly trigger is off. */
  weeklyDay: number | null;
  /** `HH:MM`, UTC; kept while the weekly trigger is off. */
  weeklyTime: string | null;
  /** The every-N threshold; null when that trigger is off. */
  everyNBuilds: number | null;
  /** Builds finished since the every-N trigger last fired — the live counter. */
  buildCounter: number;
  maxBuilds: number;
  maxLogLines: number;
  computeCeilingSeconds: number;
}

/**
 * The schedule of a repository that has none: V080's column defaults, every trigger off.
 *
 * @param repoRef - The repository.
 * @returns The unsaved defaults.
 */
export function unsavedSchedule(repoRef: string): AnalysisScheduleResource {
  return {
    repo: repoRef,
    saved: false,
    enabled: true,
    weeklyEnabled: false,
    weeklyDay: null,
    weeklyTime: null,
    everyNBuilds: null,
    buildCounter: 0,
    maxBuilds: DEFAULT_BUDGET.maxBuilds,
    maxLogLines: DEFAULT_BUDGET.maxLogLines,
    computeCeilingSeconds: DEFAULT_BUDGET.computeCeilingSeconds,
  };
}

/**
 * A schedule row, as the API answers it.
 *
 * @param row - The row; `weekly_time` reads as `HH:MM:SS` and `max_log_lines` as a string.
 * @returns The resource, the time cut to `HH:MM`.
 */
export function scheduleResource(row: AnalysisScheduleRow): AnalysisScheduleResource {
  return {
    repo: row.repo_ref,
    saved: true,
    enabled: row.enabled,
    weeklyEnabled: row.weekly_enabled,
    weeklyDay: row.weekly_day,
    weeklyTime: row.weekly_time === null ? null : row.weekly_time.slice(0, 5),
    everyNBuilds: row.every_n_builds,
    buildCounter: row.build_counter,
    maxBuilds: row.max_builds,
    maxLogLines: Number(row.max_log_lines),
    computeCeilingSeconds: row.compute_ceiling_seconds,
  };
}
