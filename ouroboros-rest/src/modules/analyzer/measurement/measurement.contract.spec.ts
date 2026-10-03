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
 * to the `Measurements` schema the UI's client is generated from.
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
});
