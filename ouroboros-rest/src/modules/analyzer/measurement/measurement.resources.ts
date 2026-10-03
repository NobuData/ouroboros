/**
 * What `GET /api/v1/analyzer/measurements` answers (BV.6, [#515](https://github.com/NobuData/ouroboros/issues/515))
 * — mockup 18's **Predicted vs Measured** card and its recalibration popover, for BW.5 (#520).
 *
 * The stored documents (`baseline`, `predicted`, `measured`) are passed through as V085 shapes
 * them; the columns become the API's `camelCase`.
 */

import type { Confound } from "./measurement.math";
import type { CalibrationRow, MeasurementRow } from "./measurement.repository";

/** One applied suggestion's measurement. */
export interface MeasurementResource {
  id: string;
  suggestionId: string;
  /** The suggestion's title, as composed. */
  title: string;
  appliedAt: string;
  appliedOn: string;
  /** Day N of `windowDays` — the pending card's progress; `windowDays` once the window is over. */
  day: number;
  windowDays: number;
  windowEndsOn: string;
  targetMetric: string;
  baseline: unknown;
  predicted: unknown;
  /** Null while pending. */
  measured: unknown;
  verdict: string;
  confounds: Confound[];
  /** The composed note — *"under-delivered — analyzer revised its cache model"*. */
  note: string | null;
  closedAt: string | null;
}

/** One calibration factor, and every update that moved it. */
export interface CalibrationResource {
  analyzer: string;
  impactClass: string;
  factor: number;
  sampleCount: number;
  updatedAt: string;
  /** Newest first. */
  history: {
    fromFactor: number;
    toFactor: number;
    sampleCount: number;
    measuredSum: number;
    predictedSum: number;
    measurementIds: string[];
    addedMeasurementIds: string[];
    createdAt: string;
  }[];
}

/** The read: the repository's measurements and its calibration. */
export interface MeasurementsResource {
  repo: string;
  /** The documented formula, so a client can show the arithmetic it is reading. */
  formula: string;
  measurements: MeasurementResource[];
  calibration: CalibrationResource[];
}

/** The calibration formula, as V085 and V089 define it. */
export const CALIBRATION_FORMULA =
  "factor = round(Σ clamp(measured ÷ raw, 0, 2) × raw ÷ Σ raw, 4), raw = predicted ÷ the factor it " +
  "was made with, over the analyzer's delivered, under and over measurements of this impact class";

/**
 * @param row - A stored measurement.
 * @returns The resource.
 */
export function measurementResource(row: MeasurementRow): MeasurementResource {
  return {
    id: row.id,
    suggestionId: row.suggestion_id,
    title: row.title,
    appliedAt: row.applied_at.toISOString(),
    appliedOn: row.applied_on,
    day: row.day,
    windowDays: row.window_days,
    windowEndsOn: row.window_ends_on,
    targetMetric: row.target_metric,
    baseline: row.baseline,
    predicted: row.predicted,
    measured: row.measured,
    verdict: row.verdict,
    confounds: row.confounds,
    note: row.note,
    closedAt: row.closed_at === null ? null : row.closed_at.toISOString(),
  };
}

/**
 * @param row - A stored cell with its history.
 * @returns The resource.
 */
export function calibrationResource(row: CalibrationRow): CalibrationResource {
  return {
    analyzer: row.analyzer,
    impactClass: row.impact_class,
    factor: Number(row.factor),
    sampleCount: row.sample_count,
    updatedAt: row.updated_at.toISOString(),
    history: row.history.map((entry) => ({
      fromFactor: Number(entry.from_factor),
      toFactor: Number(entry.to_factor),
      sampleCount: entry.sample_count,
      measuredSum: Number(entry.measured_sum),
      predictedSum: Number(entry.predicted_sum),
      measurementIds: entry.measurement_ids,
      addedMeasurementIds: entry.added_measurement_ids,
      createdAt: new Date(entry.created_at).toISOString(),
    })),
  };
}
