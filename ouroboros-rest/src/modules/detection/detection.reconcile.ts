/**
 * `detected → measured` — the tests row upgraded from the test-results plane
 * ([#384](https://github.com/NobuData/ouroboros/issues/384), reading AS.1's
 * [#324](https://github.com/NobuData/ouroboros/issues/324) tables).
 *
 * Globbing test files gives `5 suites, 63 tests (detected)` — an estimate that says so. When the
 * repository has a completed test run, the same row is replaced by the real counts and relabelled
 * `measured`. It costs the scan nothing (one query, no host request), and it happens twice: at scan
 * time, before the row is stored, and on read, so a scan taken before the first run is upgraded
 * the first time the card is opened after one.
 */

import { plural } from "./packs/pack.helpers";
import type { DetectionRow } from "./detection.scan";

/** The newest completed test run of a repository, as the test plane holds it. */
export interface MeasuredTests {
  /** `test_runs.id`. */
  readonly testRunId: string;
  /** `runs.id` — the loop run the results belong to. */
  readonly runId: string;
  /** Distinct suite names in that attempt. */
  readonly suites: number;
  /** `test_runs.total`. */
  readonly tests: number;
  /** When the attempt started. */
  readonly startedAt: Date;
}

/**
 * The tests row the measurement supports.
 *
 * @param measured - The test run.
 * @param detected - The row it replaces, when there was one — its line is kept in the evidence so
 *   the estimate and the measurement can be compared.
 * @returns The row: `ok`, `measured`, confidence `high`.
 */
export function measuredTestsRow(measured: MeasuredTests, detected?: DetectionRow): DetectionRow {
  return {
    rowKey: "tests",
    verdict: measured.tests > 0 ? "ok" : "missing",
    value: `${plural(measured.suites, "suite")}, ${plural(measured.tests, "test")} (measured)`,
    confidence: "high",
    label: "measured",
    evidence: {
      source: "test_plane",
      testRunId: measured.testRunId,
      runId: measured.runId,
      startedAt: measured.startedAt.toISOString(),
      suites: measured.suites,
      tests: measured.tests,
      confidence: "high",
      ...(detected === undefined
        ? {}
        : { detected: detected.value, detectedEvidence: detected.evidence }),
    },
  };
}

/**
 * Replace a scan's tests row with the measured one, when there is a measurement.
 *
 * @param rows - The scan's rows.
 * @param measured - The newest completed test run, or undefined.
 * @returns The rows, the tests row replaced in place; unchanged without a measurement, or when the
 *   scan has no tests row (a pack set without one).
 */
export function reconcileRows(
  rows: readonly DetectionRow[],
  measured: MeasuredTests | undefined,
): DetectionRow[] {
  if (measured === undefined) {
    return [...rows];
  }

  return rows.map((row) =>
    row.rowKey === "tests" && row.label === "detected" ? measuredTestsRow(measured, row) : row,
  );
}
