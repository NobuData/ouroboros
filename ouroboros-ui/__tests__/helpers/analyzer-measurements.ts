import type { CalibrationCell, Measurement, Measurements } from "@/app/api/analyzer";

/**
 * The Build Analyzer's seeded predicted-vs-measured pair (#520) — what
 * `GET /api/v1/analyzer/measurements` answers over the dev seed for
 * `acme-robotics/helios-firmware` (`R__dev_seed_workspace_metrics_analyzer.sql`), transcribed from
 * the service's own answer and dated for the day these fixtures stand on (`ANALYZER_NOW` in
 * `./analyzer`): mockup 18's *applied Jul 2* and *applied Jul 9* (37 and 30 days before its
 * *today*) are Aug 26 and Sep 2 here.
 *
 * - **Test-suite split** — predicted −220 s, measured −235 s: `delivered`.
 * - **ccache warm-up** — predicted −110 s, measured −72 s: `under`, with the composed note
 *   *under-delivered — analyzer revised its cache model*.
 *
 * And the two calibration cells those closes moved: `cache_window` to × 0.6545 and
 * `workflow_outcome` to × 1.0682, each with the one update that did it.
 *
 * Beside the seed's pair, the two states the seed never holds — {@link pendingMeasurement} and
 * {@link confoundedMeasurement} — shaped as #515's job writes them.
 */

/** The formula, as the service states it. */
export const SEEDED_FORMULA =
  "factor = round(Σ clamp(measured ÷ raw, 0, 2) × raw ÷ Σ raw, 4), raw = predicted ÷ the factor it was made with, over the analyzer's delivered, under and over measurements of this impact class";

/** The seeded delivered measurement's id (*Test-suite split*). */
export const DELIVERED_ID = "5eed0069-0000-4000-8000-000000000001";

/** The seeded under-delivered measurement's id (*ccache warm-up*). */
export const UNDER_ID = "5eed0069-0000-4000-8000-000000000002";

/** The suggestion behind the seeded under-delivered measurement. */
export const UNDER_SUGGESTION_ID = "5eed0067-0000-4000-8000-000000000002";

/** The note #515's job composes for a measurement two events interfered with. */
export const CONFOUNDED_NOTE = "confounded — 2 interfering events in the window; not counted toward calibration";

/** The seeded answer. Never handed out itself — {@link seededMeasurements} copies it. */
const SEEDED: Measurements = {
  repo: "acme-robotics/helios-firmware",
  formula: SEEDED_FORMULA,
  measurements: [
    {
      id: UNDER_ID,
      suggestionId: UNDER_SUGGESTION_ID,
      title: "ccache warm-up",
      appliedAt: "2026-09-02T10:00:00.000Z",
      appliedOn: "2026-09-02",
      day: 14,
      windowDays: 14,
      windowEndsOn: "2026-09-16",
      targetMetric: "stage_duration",
      baseline: { value: 380, window: { from: "2026-08-19", to: "2026-09-01" } },
      predicted: {
        unit: "seconds",
        basis: { method: "measured", description: "9 runner starts, cold against warm", sample_size: 9 },
        delta: -110,
        calibration: { factor: 1, analyzer: "cache_window", impact_class: "duration_delta" },
      },
      measured: { delta: -72, value: 308, window: { from: "2026-09-02", to: "2026-09-16" } },
      verdict: "under",
      confounds: [],
      note: "under-delivered — analyzer revised its cache model",
      closedAt: "2026-09-17T03:00:00.000Z",
    },
    {
      id: DELIVERED_ID,
      suggestionId: "5eed0067-0000-4000-8000-000000000001",
      title: "Test-suite split",
      appliedAt: "2026-08-26T10:00:00.000Z",
      appliedOn: "2026-08-26",
      day: 14,
      windowDays: 14,
      windowEndsOn: "2026-09-09",
      targetMetric: "cycle_time",
      baseline: { value: 912, window: { from: "2026-08-12", to: "2026-08-25" } },
      predicted: {
        unit: "seconds",
        basis: { method: "extrapolated", description: "the test stage's share of loop time, sharded four ways" },
        delta: -220,
        calibration: { factor: 1, analyzer: "workflow_outcome", impact_class: "duration_delta" },
      },
      measured: { delta: -235, value: 677, window: { from: "2026-08-26", to: "2026-09-09" } },
      verdict: "delivered",
      confounds: [],
      note: null,
      closedAt: "2026-09-10T03:00:00.000Z",
    },
  ],
  calibration: [
    {
      analyzer: "cache_window",
      impactClass: "duration_delta",
      factor: 0.6545,
      sampleCount: 1,
      updatedAt: "2026-09-17T03:00:00.000Z",
      history: [
        {
          fromFactor: 1,
          toFactor: 0.6545,
          sampleCount: 1,
          measuredSum: -72,
          predictedSum: -110,
          measurementIds: [UNDER_ID],
          addedMeasurementIds: [UNDER_ID],
          createdAt: "2026-09-17T03:00:00.000Z",
        },
      ],
    },
    {
      analyzer: "workflow_outcome",
      impactClass: "duration_delta",
      factor: 1.0682,
      sampleCount: 1,
      updatedAt: "2026-09-10T03:00:00.000Z",
      history: [
        {
          fromFactor: 1,
          toFactor: 1.0682,
          sampleCount: 1,
          measuredSum: -235,
          predictedSum: -220,
          measurementIds: [DELIVERED_ID],
          addedMeasurementIds: [DELIVERED_ID],
          createdAt: "2026-09-10T03:00:00.000Z",
        },
      ],
    },
  ],
};

/**
 * The seeded pair and its calibration — a fresh copy, newest apply first as the service answers.
 *
 * @param over Fields to replace.
 * @returns The answer.
 */
export function seededMeasurements(over: Partial<Measurements> = {}): Measurements {
  return { ...structuredClone(SEEDED), ...over };
}

/**
 * A repository nothing has been applied in: no measurement, no calibration cell.
 *
 * @returns The empty answer.
 */
export function noMeasurements(): Measurements {
  return { repo: SEEDED.repo, formula: SEEDED_FORMULA, measurements: [], calibration: [] };
}

/**
 * An answer holding these measurements — newest apply first — over the seed's calibration.
 *
 * @param rows The measurements.
 * @param calibration The calibration cells; the seed's two when omitted.
 * @returns The answer.
 */
export function measurementsWith(rows: readonly Measurement[], calibration?: readonly CalibrationCell[]): Measurements {
  return {
    ...seededMeasurements(),
    measurements: [...rows].sort((a, b) => b.appliedAt.localeCompare(a.appliedAt)),
    ...(calibration === undefined ? {} : { calibration: [...calibration] }),
  };
}

/**
 * One seeded measurement.
 *
 * @param id {@link DELIVERED_ID} or {@link UNDER_ID}.
 * @param over Fields to replace.
 * @returns The measurement.
 */
export function seededMeasurement(id: string, over: Partial<Measurement> = {}): Measurement {
  const found = seededMeasurements().measurements.find((measurement) => measurement.id === id);

  if (found === undefined) throw new Error(`no seeded measurement ${id}`);

  return { ...found, ...over };
}

/**
 * A measurement still inside its window, as #515's job opens one at apply: day 3 of 14 on pool-a's
 * p95 queue wait, nothing measured, no verdict.
 *
 * @param over Fields to replace.
 * @returns The measurement.
 */
export function pendingMeasurement(over: Partial<Measurement> = {}): Measurement {
  return {
    id: "5eed0069-0000-4000-8000-000000000003",
    suggestionId: "5eed0067-0000-4000-8000-000000000013",
    title: "Shift pool-a's weekday autoscale floor",
    appliedAt: "2026-09-30T09:12:00.000Z",
    appliedOn: "2026-09-30",
    day: 3,
    windowDays: 14,
    windowEndsOn: "2026-10-14",
    targetMetric: "queue_wait",
    baseline: { value: 412, statistic: "p95", dimension: "pool-a", window: { from: "2026-09-16", to: "2026-09-29" } },
    predicted: {
      unit: "seconds",
      basis: { method: "measured", description: "p95 queue wait on pool-a, weekday mornings", sample_size: 118 },
      delta: -240,
      calibration: { factor: 1, analyzer: "queue_correlation", impact_class: "duration_delta" },
    },
    measured: null,
    verdict: "pending",
    confounds: [],
    note: null,
    closedAt: null,
    ...over,
  };
}

/**
 * A measurement the job closed as **confounded**: another suggestion was applied inside its
 * window against the same metric (the seeded *ccache warm-up*), and a change-point was detected
 * on it — so the measured change is recorded and attributed to nothing.
 *
 * @param changePoint The interfering change-point: its finding and its day.
 * @param over Fields to replace.
 * @returns The measurement.
 */
export function confoundedMeasurement(
  changePoint: { id: string; date: string },
  over: Partial<Measurement> = {},
): Measurement {
  return {
    id: "5eed0069-0000-4000-8000-000000000004",
    suggestionId: "5eed0067-0000-4000-8000-000000000014",
    title: "Pin the Zephyr SDK image",
    appliedAt: "2026-08-30T08:00:00.000Z",
    appliedOn: "2026-08-30",
    day: 14,
    windowDays: 14,
    windowEndsOn: "2026-09-13",
    targetMetric: "stage_duration",
    baseline: { value: 380, window: { from: "2026-08-16", to: "2026-08-29" } },
    predicted: {
      unit: "seconds",
      basis: { method: "measured", description: "image pull time over 40 builds", sample_size: 40 },
      delta: -45,
      calibration: { factor: 1, analyzer: "cache_window", impact_class: "duration_delta" },
    },
    measured: { delta: -96, value: 284, window: { from: "2026-08-30", to: "2026-09-13" } },
    verdict: "confounded",
    confounds: [
      { kind: "application", id: UNDER_SUGGESTION_ID, date: "2026-09-02" },
      { kind: "change_point", id: changePoint.id, date: changePoint.date },
    ],
    note: CONFOUNDED_NOTE,
    closedAt: "2026-09-14T03:00:00.000Z",
    ...over,
  };
}
