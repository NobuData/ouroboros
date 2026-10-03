/**
 * What an apply writes down before the outcome is known (BV.5,
 * [#514](https://github.com/NobuData/ouroboros/issues/514); BU.3's `suggestion_measurements`, V085)
 * — the target metric, the baseline over the window before the change, and the prediction with
 * the calibration it was made under. Pure: the repository reads the rollups, this decides what they
 * mean.
 *
 * **Each impact class is measured on one rolled-up metric** (BI's grain, the rollups every other
 * page reads), in the impact's own unit:
 *
 * | impact class | target metric | statistic | unit |
 * |---|---|---|---|
 * | `duration_delta`, `attempt_duration`, `build_duration` | `build_duration` | median | seconds |
 * | `queue_wait` | `queue_wait`, the moved-to pool's rows | p95 | seconds |
 * | `interventions` | `human_interventions` | sum per week | interventions |
 *
 * The rollups store milliseconds; a duration baseline is converted to seconds so `baseline.value`,
 * `measured.value` and both deltas share `predicted.unit`, as V085 requires. A median or
 * percentile pools every retained sample of the window (V078's rule) — never an average of days.
 */

import type { Impact } from "../composer/composer.types";

/** How a window's rows become one number. */
export type BaselineStatistic = "median" | "p95" | "weekly_sum";

/** Where an impact class is measured. */
export interface MeasurementTarget {
  /** `metric_definitions.metric_id`. */
  metric: string;
  statistic: BaselineStatistic;
  /** Milliseconds → the impact's unit. */
  scale: number;
}

/** The impact classes an apply can measure — see the file header. */
export const MEASUREMENT_TARGETS: Readonly<Record<string, MeasurementTarget>> = {
  duration_delta: { metric: "build_duration", statistic: "median", scale: 1 / 1000 },
  attempt_duration: { metric: "build_duration", statistic: "median", scale: 1 / 1000 },
  build_duration: { metric: "build_duration", statistic: "median", scale: 1 / 1000 },
  queue_wait: { metric: "queue_wait", statistic: "p95", scale: 1 / 1000 },
  interventions: { metric: "human_interventions", statistic: "weekly_sum", scale: 1 },
};

/** One rolled-up day of the target metric. */
export interface MetricPoint {
  day: string;
  dimension: string;
  value: number;
  samples: number[];
}

/** A UTC-day window, inclusive. */
export interface DayWindow {
  from: string;
  to: string;
}

/**
 * The window before an apply: `days` UTC days, ending the day before the apply day — so
 * `baseline.window.to` is before `applied_on`, as `suggestion_measurements_baseline_precedes` asks.
 *
 * @param appliedAt - The apply instant.
 * @param days - The measurement window's length.
 * @returns The window.
 */
export function baselineWindow(appliedAt: Date, days: number): DayWindow {
  const day = Date.UTC(appliedAt.getUTCFullYear(), appliedAt.getUTCMonth(), appliedAt.getUTCDate());
  const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(day - days * 86_400_000), to: iso(day - 86_400_000) };
}

/**
 * A percentile of ascending numbers, as PostgreSQL's `percentile_cont` computes it.
 *
 * @param sorted - Ascending, non-empty.
 * @param fraction - 0.5 for the median, 0.95 for p95.
 * @returns The interpolated value.
 */
export function percentile(sorted: readonly number[], fraction: number): number {
  const rank = (sorted.length - 1) * fraction;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/**
 * A window's value of the target metric, in the impact's unit — the baseline before an apply, and
 * BV.6's measured value after it — or `undefined` when a median or percentile has no sample to be
 * taken over.
 *
 * @param target - Where the impact is measured.
 * @param points - The window's rows (already narrowed to a dimension when the target has one).
 * @param days - The window's length, for a weekly rate.
 * @returns The value, rounded to two places.
 */
export function windowValue(
  target: MeasurementTarget,
  points: readonly MetricPoint[],
  days: number,
): number | undefined {
  if (target.statistic === "weekly_sum") {
    const total = points.reduce((sum, point) => sum + point.value, 0);
    return round2(((total * 7) / days) * target.scale);
  }
  const samples = points.flatMap((point) => point.samples).sort((a, b) => a - b);
  if (samples.length === 0) return undefined;
  return round2(percentile(samples, target.statistic === "p95" ? 0.95 : 0.5) * target.scale);
}

/**
 * @param value - Any number.
 * @returns It, to two decimal places.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** BU.3's `predicted`, as V085's `suggestion_measurement_predicted_valid` reads it. */
export interface Predicted {
  delta: number;
  unit: Impact["unit"];
  basis: { method: "measured" | "extrapolated"; description: string; sample_size?: number };
  calibration: { analyzer: string; impact_class: string; factor: number };
}

/**
 * The prediction an apply freezes, from the suggestion's composed impact.
 *
 * @param impact - The suggestion's impact — quantified, since a spike is never applied.
 * @returns `predicted`, or `undefined` when the impact carries no estimate to freeze.
 */
export function predictedOf(impact: Impact): Predicted | undefined {
  const { basis } = impact;
  if (impact.estimate === null || impact.estimate === 0 || basis.method === "unquantified") {
    return undefined;
  }
  return {
    delta: impact.estimate,
    unit: impact.unit,
    basis: {
      method: basis.method,
      description: basis.description,
      ...(basis.method === "measured" && basis.sample_size !== undefined
        ? { sample_size: basis.sample_size }
        : {}),
    },
    calibration: { ...basis.calibration },
  };
}
