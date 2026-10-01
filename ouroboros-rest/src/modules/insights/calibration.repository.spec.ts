import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import type { EstimateOutcome } from "../db/schema";
import { CalibrationRepository } from "./calibration.repository";

/**
 * V077's statements: the fill is the migration's function — the join is proved in
 * `tests/constraints.sql`, not re-implemented here — and the report's sums are scoped to the
 * workspace and a half-open window, grouped by predicted effort.
 */

const ORG = "org-calibration";
const PR = "a7770000-0000-0000-0000-000000000514";
const FROM = new Date("2026-09-01T12:00:00.000Z");
const TO = new Date("2026-10-01T12:00:00.000Z");

const ROW = {
  id: "a7780000-0000-0000-0000-000000000001",
  organization_id: ORG,
  pr_id: PR,
  ticket_id: "a7730000-0000-0000-0000-000000000514",
  estimate_id: "a7750000-0000-0000-0000-000000514001",
  queued_at: new Date("2026-09-01T10:00:00.000Z"),
  predicted_effort: "s",
  predicted_cycle_min: 12,
  predicted_cycle_max: 18,
  actual_duration_ms: "860000",
  within_band: true,
  deviation_ms: "-40000",
  merged_at: new Date("2026-09-01T11:14:20.000Z"),
  computed_at: new Date("2026-09-01T11:14:21.000Z"),
} satisfies EstimateOutcome;

describe("the calibration repository", () => {
  let database: RecordingDatabase;
  let calibration: CalibrationRepository;

  beforeEach(() => {
    database = recordingDatabase();
    calibration = new CalibrationRepository(database.service);
  });

  it("fills through record_estimate_outcome, scoped to the workspace", async () => {
    database.answers({ rows: [ROW] });

    await expect(calibration.record(ORG, PR)).resolves.toEqual(ROW);
    expect(database.statements[0].sql).toContain(
      "select * from ouroboros.record_estimate_outcome($1, $2::uuid)",
    );
    expect(database.statements[0].parameters).toEqual([ORG, PR]);
  });

  it("answers undefined for a PR that is not a merged loop PR", async () => {
    await expect(calibration.record(ORG, PR)).resolves.toBeUndefined();
  });

  it("sums a half-open window per predicted effort", async () => {
    await calibration.sums(ORG, { from: FROM, to: TO });

    const [{ sql, parameters }] = database.statements;

    expect(sql).toContain("from ouroboros.estimate_outcomes");
    expect(sql).toContain("merged_at >= $2");
    expect(sql).toContain("merged_at < $3");
    expect(sql).toContain("group by predicted_effort");
    expect(parameters).toEqual([ORG, FROM, TO]);
  });

  it("turns pg's bigint strings into numbers, and an all-null sum into 0", async () => {
    database.answers({
      rows: [
        {
          effort: "l",
          merged: "4",
          within_band: "3",
          over: "1",
          under: "0",
          deviation_ms: "1008000",
          midpoint_ms: "8400000",
        },
        {
          effort: null,
          merged: "2",
          within_band: "0",
          over: "0",
          under: "0",
          deviation_ms: null,
          midpoint_ms: null,
        },
      ],
    });

    await expect(calibration.sums(ORG, { from: FROM, to: TO })).resolves.toEqual([
      {
        effort: "l",
        merged: 4,
        withinBand: 3,
        over: 1,
        under: 0,
        deviationMs: 1_008_000,
        midpointMs: 8_400_000,
      },
      { effort: null, merged: 2, withinBand: 0, over: 0, under: 0, deviationMs: 0, midpointMs: 0 },
    ]);
  });
});
