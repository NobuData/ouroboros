/**
 * The suggestion cards' stand-ins (BW.3, #518) — the dev seed's *Move forge-02 to pool-a* as V081
 * and V087 store it, the `queue_correlation` finding it cites, the analysis that composed it, and
 * the measurement and calibration rows BU.3 keeps beside it.
 *
 * Not shipped: `*.fixture.ts` is excluded from the build.
 */

import { FORGE_02_ID, POOL_A_ID } from "../composer/composer.seed.fixture";
import type { CalibrationRow, MeasurementRow } from "../measurement/measurement.repository";
import type {
  ComposedRun,
  SuggestionFindingRow,
  SuggestionListRow,
} from "./suggestions.repository";

/** The seeded repository. */
export const HELIOS = "acme-robotics/helios-firmware";

/** The seeded analysis the page shows. */
export const RUN_ID = "5eed0065-0000-4000-8000-000000000002";

/** *Move forge-02 to pool-a during 14:00–16:00 UTC*. */
export const RUNNER_MOVE_ID = "5eed0067-0000-4000-8000-000000000013";

/** The `queue_correlation` finding it cites. */
export const QUEUE_FINDING_ID = "5eed0066-0000-4000-8000-000000000151";

/** pool-a, and forge-02 — the first two references the finding cites. */
export { FORGE_02_ID, POOL_A_ID } from "../composer/composer.seed.fixture";

/**
 * The analysis that composed the suggestions.
 *
 * @param overrides - Columns to replace.
 * @returns The run.
 */
export function composedRun(overrides: Partial<ComposedRun> = {}): ComposedRun {
  return {
    id: RUN_ID,
    finished_at: new Date("2026-08-08T10:41:00Z"),
    ...overrides,
  };
}

/**
 * The runner move, open, exactly as the composer stored it.
 *
 * @param overrides - Columns to replace.
 * @returns The row.
 */
export function suggestionRow(overrides: Partial<SuggestionListRow> = {}): SuggestionListRow {
  return {
    id: RUNNER_MOVE_ID,
    kind: "build_process",
    title: "Move forge-02 to pool-a during 14:00–16:00 UTC",
    evidence_line:
      "pool-a queue exceeds 5 min in that window on 11 of last 14 weekdays; pool-b sits idle 82% of it",
    confidence: 84,
    confidence_basis: {
      formula: "composer v1: round(100 * (1 - e^(-n/scale)) * stability * min(1, |effect|/target))",
      inputs: {
        template: "runner_move",
        n: 14,
        scale: 5,
        support: 0.9392,
        stability: 0.895,
        effect_size: 0.786,
        effect_target: 0.75,
        effect: 1,
      },
      value: 84,
    },
    impact: {
      estimate: -240,
      unit: "seconds",
      applies_to: "queue p95",
      basis: {
        method: "extrapolated",
        description: "pool-a's window waits with forge-02 taking the backlog",
        formula: "runner_move v1: -wait_reduction_seconds",
        inputs: { wait_reduction_seconds: 240 },
        window: { from: "2026-05-10", to: "2026-08-07", days: 90 },
        calibration: { analyzer: "queue_correlation", impact_class: "queue_wait", factor: 1 },
        raw: -240,
      },
    },
    needs_spike: false,
    action_binding: {
      plane: "farm_config",
      change: {
        runner: "forge-02",
        pool: "pool-a",
        days_of_week: [1, 2, 3, 4, 5],
        starts_at: "14:00",
        ends_at: "16:00",
      },
    },
    status: "open",
    resolved_at: null,
    resolved_by_name: null,
    resolution_reason: null,
    draft_batch_id: null,
    workflow_slug: null,
    workflow_version: null,
    ...overrides,
  };
}

/**
 * The finding the runner move cites, as `queue_correlation` v1 emits it.
 *
 * @param overrides - Columns to replace.
 * @returns The row.
 */
export function findingRow(overrides: Partial<SuggestionFindingRow> = {}): SuggestionFindingRow {
  return {
    suggestion_id: RUNNER_MOVE_ID,
    id: QUEUE_FINDING_ID,
    analyzer: "queue_correlation",
    analyzer_version: 1,
    finding_type: "queue_correlation",
    subject_key: "pool-a@14:00-16:00",
    data: {
      window: { from: "14:00", to: "16:00" },
      metric: "queue_wait",
      threshold_seconds: 300,
      days_exceeded: 11,
      days_observed: 14,
      idle_share: 0.82,
      wait_reduction_seconds: 240,
    },
    evidence_refs: [
      { kind: "runner_pool", id: POOL_A_ID },
      { kind: "runner", id: FORGE_02_ID },
    ],
    confidence: 84,
    confidence_basis: {
      method:
        "queue_correlation v1: weekdays whose longest pool-a wait in the window crossed the threshold, against the other pool's idle share",
      sample_size: 14,
      effect_size: 0.786,
      stability: 0.895,
    },
    ...overrides,
  };
}

/**
 * The measurement an apply of the runner move opened — pending, on day 3 of 14.
 *
 * @param overrides - Columns to replace.
 * @returns The row.
 */
export function measurementRow(overrides: Partial<MeasurementRow> = {}): MeasurementRow {
  return {
    id: "5eed0069-0000-4000-8000-000000000013",
    suggestion_id: RUNNER_MOVE_ID,
    title: "Move forge-02 to pool-a during 14:00–16:00 UTC",
    repo_ref: HELIOS,
    applied_at: new Date("2026-08-08T12:00:00Z"),
    applied_on: "2026-08-08",
    window_days: 14,
    window_ends_on: "2026-08-22",
    day: 3,
    target_metric: "queue_wait",
    baseline: { window: { from: "2026-07-25", to: "2026-08-07" }, value: 540 },
    predicted: { delta: -240, unit: "seconds" },
    measured: null,
    verdict: "pending",
    confounds: [],
    note: null,
    closed_at: null,
    ...overrides,
  };
}

/**
 * The cache model's calibration cell, with the one update that moved it.
 *
 * @returns The row.
 */
export function calibrationRow(): CalibrationRow {
  return {
    analyzer: "cache_window",
    impact_class: "duration_delta",
    factor: "0.6545",
    sample_count: 1,
    updated_at: new Date("2026-07-24T03:00:00Z"),
    history: [
      {
        from_factor: "1",
        to_factor: "0.6545",
        sample_count: 1,
        measured_sum: "-72",
        predicted_sum: "-110",
        measurement_ids: ["5eed0069-0000-4000-8000-000000000002"],
        added_measurement_ids: ["5eed0069-0000-4000-8000-000000000002"],
        created_at: "2026-07-24T03:00:00Z",
      },
    ],
  };
}
