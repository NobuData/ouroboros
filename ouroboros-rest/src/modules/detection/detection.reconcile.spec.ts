/** `detected → measured` ([#384](https://github.com/NobuData/ouroboros/issues/384)). */

import { measuredTestsRow, reconcileRows, type MeasuredTests } from "./detection.reconcile";
import type { DetectionRow } from "./detection.scan";

const MEASURED: MeasuredTests = {
  testRunId: "7e570000-0000-0000-0000-000000000001",
  runId: "7e570000-0000-0000-0000-000000000002",
  suites: 5,
  tests: 71,
  startedAt: new Date("2026-09-29T10:00:00.000Z"),
};

const DETECTED: DetectionRow = {
  rowKey: "tests",
  verdict: "ok",
  value: "5 suites, 63 tests (detected)",
  evidence: { pack: "tests", tests: 63 },
  confidence: "medium",
  label: "detected",
};

const BUILD: DetectionRow = {
  ...DETECTED,
  rowKey: "build",
  value: "west + twister (found west.yml)",
};

describe("measuredTestsRow", () => {
  it("states the real counts, labelled measured, with the estimate kept for comparison", () => {
    expect(measuredTestsRow(MEASURED, DETECTED)).toEqual({
      rowKey: "tests",
      verdict: "ok",
      value: "5 suites, 71 tests (measured)",
      confidence: "high",
      label: "measured",
      evidence: {
        source: "test_plane",
        testRunId: MEASURED.testRunId,
        runId: MEASURED.runId,
        startedAt: "2026-09-29T10:00:00.000Z",
        suites: 5,
        tests: 71,
        confidence: "high",
        detected: "5 suites, 63 tests (detected)",
        detectedEvidence: DETECTED.evidence,
      },
    });
  });

  it("says missing for a run that measured nothing, and agrees in number", () => {
    expect(measuredTestsRow({ ...MEASURED, suites: 1, tests: 0 })).toMatchObject({
      verdict: "missing",
      value: "1 suite, 0 tests (measured)",
    });
  });
});

describe("reconcileRows", () => {
  it("replaces only the detected tests row", () => {
    const rows = reconcileRows([BUILD, DETECTED], MEASURED);

    expect(rows[0]).toBe(BUILD);
    expect(rows[1]).toMatchObject({ label: "measured", value: "5 suites, 71 tests (measured)" });
  });

  it("leaves the rows alone without a measurement", () => {
    expect(reconcileRows([BUILD, DETECTED], undefined)).toEqual([BUILD, DETECTED]);
  });

  it("never re-measures a row that is already measured", () => {
    const measured = measuredTestsRow(MEASURED);

    expect(reconcileRows([measured], { ...MEASURED, tests: 1 })[0]).toBe(measured);
  });
});
