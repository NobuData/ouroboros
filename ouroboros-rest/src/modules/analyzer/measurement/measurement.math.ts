/**
 * The measurement job's arithmetic (BV.6, [#515](https://github.com/NobuData/ouroboros/issues/515),
 * decision A6) — pure, and the same arithmetic the database holds every closed row and every
 * calibration update to, so a person can redo it by hand from the stored numbers.
 *
 * ```
 * measured window   day 1 … day N after the apply day        (day 0 is the apply day, V085)
 * ratio             measured.delta ÷ predicted.delta
 * verdict           confounded if anything interfered, else under < band ≤ delivered ≤ band < over
 * contribution      clamp(measured.delta ÷ raw, 0, 2) × raw     raw = predicted.delta ÷ its factor
 * factor            round(Σ contribution ÷ Σ raw, 4)            (V089 — bounded against an outlier)
 * ```
 *
 * **Interference** (decided with the user for #515): another application in the same repository
 * whose measurement targets the **same metric**, applied inside this window; or a change-point the
 * analyzer detected in that metric inside the window. Either makes the verdict `confounded` — never
 * a clean one — and keeps the measurement out of calibration.
 */

import type { MeasurementTarget } from "../actions/measurement";

/** A confound entry, as V085 stores it. */
export interface Confound {
  kind: "application" | "change_point";
  /** The interfering suggestion's id, or the change-point finding's. */
  id: string;
  /** `YYYY-MM-DD`, UTC. */
  date: string;
}

/** A closed verdict. */
export type Verdict = "delivered" | "under" | "over" | "confounded";

/**
 * The series the change-point analyzer names, by the metric each is a series of. The analyzer reads
 * the BI grain's `build_duration` as `build.duration_median` (engine `changepoint.py`).
 */
export const CHANGE_POINT_METRICS: Readonly<Record<string, string>> = {
  "build.duration_median": "build_duration",
};

/**
 * The metric a change-point finding is about.
 *
 * @param series - The finding's `data.metric`.
 * @returns The `metric_definitions` id — the series' mapping, or the name itself.
 */
export function changePointMetric(series: string): string {
  return CHANGE_POINT_METRICS[series] ?? series;
}

/**
 * A UTC date plus some days.
 *
 * @param day - `YYYY-MM-DD`.
 * @param days - How many days to add.
 * @returns `YYYY-MM-DD`.
 */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The window a measurement measures: day 1 to day N after the apply day. Day 0 — the apply day —
 * holds builds from both sides of the change, so it is in neither the baseline nor the measurement.
 *
 * @param appliedOn - The apply's UTC date.
 * @param windowEndsOn - `applied_on + window_days`.
 * @returns The window, inclusive.
 */
export function measuredWindow(
  appliedOn: string,
  windowEndsOn: string,
): { from: string; to: string } {
  return { from: addDays(appliedOn, 1), to: windowEndsOn };
}

/**
 * The verdict — `ouroboros.suggestion_measurement_verdict()` (V085), restated.
 *
 * @param predictedDelta - `predicted.delta`, never zero.
 * @param measuredDelta - `measured.delta`.
 * @param underBelow - The lower band.
 * @param overAbove - The upper band.
 * @param confounded - Whether anything interfered.
 * @returns The verdict.
 */
export function verdictOf(
  predictedDelta: number,
  measuredDelta: number,
  underBelow: number,
  overAbove: number,
  confounded: boolean,
): Verdict {
  if (confounded) return "confounded";
  const ratio = measuredDelta / predictedDelta;
  if (ratio < underBelow) return "under";
  if (ratio > overAbove) return "over";
  return "delivered";
}

/**
 * Round to a number of decimal places, half away from zero as PostgreSQL's `round(numeric, n)`.
 *
 * @param value - The number.
 * @param places - The places.
 * @returns The rounded number.
 */
export function roundTo(value: number, places: number): number {
  const scale = 10 ** places;
  // `+ 0` turns a negative zero into zero, which is what PostgreSQL's numeric has.
  return (Math.sign(value) * Math.round(Math.abs(value) * scale)) / scale + 0;
}

/**
 * One measurement's bounded contribution — `analyzer_calibration_contribution()` (V089).
 *
 * @param measuredDelta - `measured.delta`.
 * @param raw - The raw prediction, `predicted.delta ÷ predicted.calibration.factor`.
 * @returns `clamp(measured ÷ raw, 0, 2) × raw`, to 6 places.
 */
export function contributionOf(measuredDelta: number, raw: number): number {
  return roundTo(Math.min(Math.max(measuredDelta / raw, 0), 2) * raw, 6);
}

/** One clean measurement of a calibration cell. */
export interface CalibrationEntry {
  measuredDelta: number;
  /** `predicted.delta ÷ predicted.calibration.factor`. */
  raw: number;
}

/**
 * A cell's factor — `recalibrate_analyzer()` (V085, bounded by V089).
 *
 * @param entries - The cell's clean measurements.
 * @returns `round(Σ contribution ÷ Σ raw, 4)`, or `undefined` when there is nothing to divide by.
 */
export function factorOf(entries: readonly CalibrationEntry[]): number | undefined {
  const measured = entries.reduce(
    (sum, entry) => sum + contributionOf(entry.measuredDelta, entry.raw),
    0,
  );
  const raw = roundTo(
    entries.reduce((sum, entry) => sum + entry.raw, 0),
    6,
  );
  return raw === 0 ? undefined : roundTo(measured / raw, 4);
}

/** What the analyzer's model is called in a note — `cache_window` is its cache model. */
const MODEL_NAMES: Readonly<Record<string, string>> = {
  cache_window: "cache",
  workflow_outcome: "workflow",
  queue_correlation: "queue",
  change_point: "change-point",
  log_signature: "log-signature",
  config_usage: "configuration",
  waiver_cite: "waiver",
};

/**
 * The composed note a closed row carries — mockup 18's *"under-delivered — analyzer revised its
 * cache model"*. A delivered measurement carries none.
 *
 * @param verdict - The verdict.
 * @param analyzer - The prediction's calibration analyzer.
 * @param fromFactor - The cell's factor before this measurement.
 * @param toFactor - After it — equal when it did not move.
 * @param confounds - What interfered.
 * @returns The note, or null.
 */
export function noteOf(
  verdict: Verdict,
  analyzer: string,
  fromFactor: number,
  toFactor: number,
  confounds: readonly Confound[],
): string | null {
  const model = `${MODEL_NAMES[analyzer] ?? analyzer.replace(/_/g, " ")} model`;
  switch (verdict) {
    case "delivered":
      return null;
    case "confounded":
      return (
        `confounded — ${String(confounds.length)} interfering ` +
        `${confounds.length === 1 ? "event" : "events"} in the window; not counted toward calibration`
      );
    case "under":
    case "over": {
      const head = verdict === "under" ? "under-delivered" : "over-delivered";
      return toFactor === fromFactor
        ? `${head} — analyzer kept its ${model} at ${toFactor.toFixed(2)}`
        : `${head} — analyzer revised its ${model}`;
    }
  }
}

/**
 * The scale from a metric's stored unit to the prediction's unit.
 *
 * @param metricUnit - `metric_definitions.unit` — `duration_ms`, `count`…
 * @param predictedUnit - `predicted.unit`.
 * @returns 1/1000 from milliseconds to seconds, else 1.
 */
export function unitScale(metricUnit: string, predictedUnit: string): number {
  return metricUnit === "duration_ms" && predictedUnit === "seconds" ? 1 / 1000 : 1;
}

/**
 * How a measurement's window is read: the statistic its baseline was taken with (BV.5 stores it),
 * or — for a row written before BV.5 — the metric's own aggregation.
 *
 * @param metric - The target metric.
 * @param baselineStatistic - `baseline.statistic`, when stored.
 * @param aggregation - `metric_definitions.aggregation`.
 * @param scale - {@link unitScale}.
 * @returns The target, or `undefined` for a ratio metric no statistic was stored for.
 */
export function targetOf(
  metric: string,
  baselineStatistic: string | undefined,
  aggregation: string,
  scale: number,
): MeasurementTarget | undefined {
  if (
    baselineStatistic === "median" ||
    baselineStatistic === "p95" ||
    baselineStatistic === "weekly_sum"
  ) {
    return { metric, statistic: baselineStatistic, scale };
  }
  if (aggregation === "median") return { metric, statistic: "median", scale };
  if (aggregation === "sum") return { metric, statistic: "weekly_sum", scale };
  return undefined;
}
