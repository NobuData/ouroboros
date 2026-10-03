import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../../openapi/specification";
import type { CalibrationRow, MeasurementRow } from "./measurement.repository";
import {
  CALIBRATION_FORMULA,
  calibrationResource,
  measurementResource,
  type MeasurementsResource,
} from "./measurement.resources";

/**
 * `GET /api/v1/analyzer/measurements` answers what `openapi.yaml` documents (BV.6, #515) — a
 * pending measurement, a closed one with its note, and a calibration cell with its history, held
 * to the `Measurements` schema the UI's client is generated from. Since BW.5 (#520) that schema
 * spells out the three stored documents — baseline, prediction and result — because the
 * Predicted-vs-measured card reads their fields.
 */

/**
 * A validator for one documented schema.
 *
 * @param name - The schema's name under `components/schemas`.
 * @returns The compiled validator.
 */
function validator(name: string) {
  const id = "https://ouroboros.build/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });
  return ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
}

/** A stored measurement. */
function row(overrides: Partial<MeasurementRow> = {}): MeasurementRow {
  return {
    id: "5eed0069-0000-4000-8000-000000000002",
    suggestion_id: "5eed0067-0000-4000-8000-000000000002",
    title: "Re-warm ccache right after deps-refresh merges",
    repo_ref: "acme-robotics/helios-firmware",
    applied_at: new Date("2026-07-09T10:00:00Z"),
    applied_on: "2026-07-09",
    window_days: 14,
    window_ends_on: "2026-07-23",
    day: 14,
    target_metric: "stage_duration",
    baseline: { window: { from: "2026-06-25", to: "2026-07-08" }, value: 380 },
    predicted: {
      delta: -110,
      unit: "seconds",
      basis: {
        method: "measured",
        description: "9 runner starts, cold against warm",
        sample_size: 9,
      },
      calibration: { analyzer: "cache_window", impact_class: "duration_delta", factor: 1 },
    },
    measured: { window: { from: "2026-07-10", to: "2026-07-23" }, value: 308, delta: -72 },
    verdict: "under",
    confounds: [],
    note: "under-delivered — analyzer revised its cache model",
    closed_at: new Date("2026-07-24T03:00:00Z"),
    ...overrides,
  };
}

/** A stored calibration cell. */
const CELL: CalibrationRow = {
  analyzer: "cache_window",
  impact_class: "duration_delta",
  factor: "0.6545",
  sample_count: 1,
  updated_at: new Date("2026-07-24T03:00:00Z"),
  history: [
    {
      from_factor: "1.0000",
      to_factor: "0.6545",
      sample_count: 1,
      measured_sum: "-72.000000",
      predicted_sum: "-110.000000",
      measurement_ids: ["5eed0069-0000-4000-8000-000000000002"],
      added_measurement_ids: ["5eed0069-0000-4000-8000-000000000002"],
      created_at: "2026-07-24T03:00:00.123456+00:00",
    },
  ],
};

describe("the measurements read, against its documented schema", () => {
  it("documents a closed measurement, a pending one and a calibration cell as sent", () => {
    const body: MeasurementsResource = {
      repo: "acme-robotics/helios-firmware",
      formula: CALIBRATION_FORMULA,
      measurements: [
        measurementResource(row()),
        measurementResource(
          row({
            id: "5eed0069-0000-4000-8000-000000000003",
            day: 3,
            measured: null,
            verdict: "pending",
            confounds: [
              {
                kind: "application",
                id: "5eed0067-0000-4000-8000-000000000001",
                date: "2026-07-11",
              },
            ],
            note: null,
            closed_at: null,
          }),
        ),
      ],
      calibration: [calibrationResource(CELL)],
    };
    const validate = validator("Measurements");

    expect(validate(body) ? null : validate.errors).toBeNull();
    expect(body.calibration[0]).toMatchObject({
      factor: 0.6545,
      history: [{ fromFactor: 1, toFactor: 0.6545 }],
    });
  });

  it("documents the stored documents' fields: an extrapolated prediction, a sliced baseline, a confounded result", () => {
    const validate = validator("Measurement");
    const moved = measurementResource(
      row({
        id: "5eed0069-0000-4000-8000-000000000004",
        target_metric: "queue_wait",
        baseline: {
          window: { from: "2026-06-25", to: "2026-07-08" },
          value: 368,
          statistic: "p95",
          dimension: "pool-a",
        },
        predicted: {
          delta: -240,
          unit: "seconds",
          // An extrapolated prediction carries no sample size (V085).
          basis: {
            method: "extrapolated",
            description: "the window's p95 wait, were the runner there",
          },
          calibration: { analyzer: "queue_correlation", impact_class: "queue_wait", factor: 1 },
        },
        measured: { window: { from: "2026-07-09", to: "2026-07-23" }, value: 150, delta: -218 },
        verdict: "confounded",
        confounds: [
          { kind: "application", id: "5eed0067-0000-4000-8000-000000000001", date: "2026-07-11" },
          { kind: "change_point", id: "5eed0066-0000-4000-8000-000000000103", date: "2026-07-15" },
        ],
        note: null,
      }),
    );

    expect(validate(moved) ? null : validate.errors).toBeNull();
    expect(moved.predicted).toMatchObject({ calibration: { impact_class: "queue_wait" } });
  });

  it.each([
    [
      "a prediction with no calibration",
      {
        predicted: {
          delta: -110,
          unit: "seconds",
          basis: { method: "measured", description: "x" },
        },
      },
    ],
    [
      "a prediction in a unit V085 does not know",
      {
        predicted: {
          delta: -1,
          unit: "minutes",
          basis: { method: "measured", description: "x" },
          calibration: { analyzer: "a", impact_class: "b", factor: 1 },
        },
      },
    ],
    ["a baseline with no window", { baseline: { value: 380 } }],
    [
      "a result with no delta",
      { measured: { window: { from: "2026-07-10", to: "2026-07-23" }, value: 308 } },
    ],
  ])("refuses %s — the card reads those fields", (_what, overrides) => {
    const validate = validator("Measurement");

    expect(validate(measurementResource(row(overrides)))).toBe(false);
  });
});
