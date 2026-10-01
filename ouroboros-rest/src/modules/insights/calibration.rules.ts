/**
 * The calibration report's arithmetic (BI.4, [#435](https://github.com/NobuData/ouroboros/issues/435)),
 * kept pure so every rule is a unit test.
 *
 * The database grades each merged loop (`estimate_outcomes.within_band`, `deviation_ms` — V077's
 * generated columns); this file turns a window's per-effort sums into the report: the headline
 * *"89% within band"*, and the effort slices with the direction of bias — *"L-effort issues run
 * 12% over"* — because the headline alone is reassuring and not actionable.
 *
 * **Rates are re-derived from counts, never averaged** (V076's component rule): the headline is
 * total in-band over total estimated, not the mean of the five slice rates.
 */

import { ISSUE_ESTIMATE_EFFORTS, type EstimateEffort } from "../db/schema";

/** The windows the Insights range segment offers — mockup 15's `7d · 30d · 90d`. */
export const CALIBRATION_WINDOWS = ["7d", "30d", "90d"] as const;

/** One of {@link CALIBRATION_WINDOWS}. */
export type CalibrationWindow = (typeof CALIBRATION_WINDOWS)[number];

/** The window the page opens on. */
export const DEFAULT_CALIBRATION_WINDOW: CalibrationWindow = "30d";

/** A day, in milliseconds. */
const DAY_MS = 86_400_000;

/** How many days each window spans. */
const WINDOW_DAYS: Record<CalibrationWindow, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** A half-open instant range, `[from, to)`. */
export interface CalibrationRange {
  /** The first instant inside the window. */
  readonly from: Date;
  /** The instant the window ends at, exclusive — now. */
  readonly to: Date;
}

/**
 * The range a window covers, ending now.
 *
 * @param window - The window.
 * @param now - The current instant.
 * @returns `[now − window, now)`.
 */
export function windowRange(window: CalibrationWindow, now: Date): CalibrationRange {
  return { from: new Date(now.getTime() - WINDOW_DAYS[window] * DAY_MS), to: now };
}

/**
 * One group of a window's outcomes, as the repository sums them — one per predicted effort, plus
 * one for the unestimated (`effort: null`).
 */
export interface CalibrationSliceSums {
  /** The predicted effort, or null for merges with no governing estimate. */
  readonly effort: EstimateEffort | null;
  /** Merged loops in the group. */
  readonly merged: number;
  /** Of those, how many landed inside their band. */
  readonly withinBand: number;
  /** Out of band, above the maximum. */
  readonly over: number;
  /** Out of band, below the minimum. */
  readonly under: number;
  /** The sum of signed deviations from the band midpoints, in milliseconds. */
  readonly deviationMs: number;
  /** The sum of the band midpoints, in milliseconds. */
  readonly midpointMs: number;
}

/**
 * Which way an effort's predictions miss: `over` (work ran longer than predicted), `under`
 * (shorter), or `even` (the signed deviations cancel exactly).
 */
export type BiasDirection = "over" | "under" | "even";

/** One effort's slice of the report. */
export interface EffortCalibration {
  /** The predicted effort. */
  readonly effort: EstimateEffort;
  /** Merged loops estimated at this effort. */
  readonly estimated: number;
  /** Of those, how many landed inside their band. */
  readonly withinBand: number;
  /** `withinBand / estimated` as a percentage to one decimal; null when nothing was estimated. */
  readonly withinBandPct: number | null;
  /** Out of band, above the maximum. */
  readonly over: number;
  /** Out of band, below the minimum. */
  readonly under: number;
  /**
   * Signed bias as a percentage of the predicted midpoints, to one decimal — `+12.0` is *"runs
   * 12% over"*. Null when nothing was estimated, or every band was `0–0`.
   */
  readonly biasPct: number | null;
  /** The direction of {@link biasPct}; null when nothing was estimated. */
  readonly bias: BiasDirection | null;
}

/** `GET /api/v1/insights/calibration` — the report. */
export interface CalibrationReport {
  /** The window asked for. */
  readonly window: CalibrationWindow;
  /** The window's first instant, ISO-8601. */
  readonly from: string;
  /** The window's end, exclusive, ISO-8601. */
  readonly to: string;
  /** Merged loops in the window, estimated or not. */
  readonly merged: number;
  /** Of those, how many had a governing estimate. */
  readonly estimated: number;
  /** Of those, how many had none — counted, never dropped. */
  readonly unestimated: number;
  /** Estimated merges that landed inside their band. */
  readonly withinBand: number;
  /** The headline: `withinBand / estimated` to one decimal; null when nothing was estimated. */
  readonly withinBandPct: number | null;
  /** Every effort, smallest first — an effort with no merges is present with zero counts. */
  readonly efforts: EffortCalibration[];
}

/**
 * A share as a percentage, to one decimal.
 *
 * @param part - The numerator.
 * @param whole - The denominator.
 * @returns `part / whole × 100` rounded to one decimal, or null when `whole` is not positive.
 */
export function percentage(part: number, whole: number): number | null {
  if (whole <= 0) {
    return null;
  }

  return Math.round((part / whole) * 1000) / 10;
}

/**
 * The direction a sum of signed deviations points.
 *
 * @param deviationMs - The summed deviations.
 * @returns `over` when positive, `under` when negative, `even` when zero.
 */
export function biasDirection(deviationMs: number): BiasDirection {
  if (deviationMs > 0) {
    return "over";
  }

  return deviationMs < 0 ? "under" : "even";
}

/**
 * One effort's slice from its sums.
 *
 * @param effort - The effort.
 * @param sums - Its group's sums, or undefined when the window has none at that effort.
 * @returns The slice; zero counts and null rates for an absent group.
 */
export function effortCalibration(
  effort: EstimateEffort,
  sums: CalibrationSliceSums | undefined,
): EffortCalibration {
  const estimated = sums?.merged ?? 0;
  const deviationMs = sums?.deviationMs ?? 0;

  return {
    effort,
    estimated,
    withinBand: sums?.withinBand ?? 0,
    withinBandPct: percentage(sums?.withinBand ?? 0, estimated),
    over: sums?.over ?? 0,
    under: sums?.under ?? 0,
    biasPct: estimated === 0 ? null : percentage(deviationMs, sums?.midpointMs ?? 0),
    bias: estimated === 0 ? null : biasDirection(deviationMs),
  };
}

/**
 * The report for a window.
 *
 * @param window - The window asked for.
 * @param range - Its instants.
 * @param groups - The window's sums, one per predicted effort and one for the unestimated, in any
 *   order; an effort with no merges may be absent.
 * @returns The headline and all five effort slices, smallest first.
 */
export function calibrationReport(
  window: CalibrationWindow,
  range: CalibrationRange,
  groups: readonly CalibrationSliceSums[],
): CalibrationReport {
  const byEffort = new Map(groups.map((group) => [group.effort, group]));
  const efforts = ISSUE_ESTIMATE_EFFORTS.map((effort) =>
    effortCalibration(effort, byEffort.get(effort)),
  );
  const estimated = efforts.reduce((total, slice) => total + slice.estimated, 0);
  const withinBand = efforts.reduce((total, slice) => total + slice.withinBand, 0);
  const unestimated = byEffort.get(null)?.merged ?? 0;

  return {
    window,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    merged: estimated + unestimated,
    estimated,
    unestimated,
    withinBand,
    withinBandPct: percentage(withinBand, estimated),
    efforts,
  };
}
