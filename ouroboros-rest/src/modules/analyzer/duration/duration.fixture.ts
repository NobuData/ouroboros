/**
 * The duration chart's stand-ins (BW.2, #517) — the dev seed's June 22 change-point (*ccache
 * enabled −2m 10s*) as V081 stores it, the run that found it, and what its references resolve to.
 *
 * Not shipped: `*.fixture.ts` is excluded from the build.
 */

import type { AnalysisRunRow } from "../analysis.repository";
import type { ResolvedEvidence } from "../evidence/evidence.repository";
import type { FindingRow } from "./duration.repository";

/** The seeded repository. */
export const HELIOS = "acme-robotics/helios-firmware";

/** The seeded run. */
export const RUN_ID = "5eed0065-0000-4000-8000-000000000002";

/** The commit *ccache enabled* merged as. */
export const CCACHE_SHA = "0c5eed47a1b2";

/** The `standard-fix v9` version published the day before. */
export const POLICY_VERSION_ID = "5eed0031-0000-4000-8000-000000000009";

/** The last build before the shift and the first on it, as the analyzer cites them. */
export const LAST_BEFORE_ID = "5eed0061-0000-4000-8000-000000000641";
export const FIRST_AFTER_ID = "5eed0061-0000-4000-8000-000000000655";

/**
 * The run that detected the change-point — complete, with the change-point analyzer done.
 *
 * @param overrides - Columns to replace.
 * @returns The row.
 */
export function annotatedRun(overrides: Partial<AnalysisRunRow> = {}): AnalysisRunRow {
  return {
    id: RUN_ID,
    organization_id: "org",
    repo_ref: HELIOS,
    trigger: "every_n_builds",
    schedule_id: null,
    status: "complete",
    corpus_manifest: {
      window: { from: "2026-05-10", to: "2026-08-07", days: 90 },
      counts: { builds: 1284, loops: 312, log_lines: 4_100_000, hil_sessions: 62 },
      sources: {},
      budget: { max_builds: 2000, max_log_lines: 1_230_000, compute_ceiling_seconds: 3600 },
      duration_label: "zephyr build",
    },
    analyzer_set: { label: "deterministic analyzers v1", analyzers: [] },
    started_at: new Date("2026-08-08T10:00:00Z"),
    finished_at: new Date("2026-08-08T10:41:00Z"),
    compute_seconds: 2460,
    llm_cost_cents: null,
    confidence_note: "high — 90d of stable telemetry",
    failure_reason: null,
    created_at: new Date("2026-08-08T10:00:00Z"),
    phase: "composing",
    progress: { analyzers: [{ id: "change_point", version: 1, status: "completed", findings: 1 }] },
    ...overrides,
  };
}

/**
 * The June 22 finding, exactly as `ChangePointAnalyzer` v1 emits it.
 *
 * @param overrides - Columns to replace.
 * @returns The row.
 */
export function changePoint(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: "5eed0066-0000-4000-8000-000000000102",
    run_id: RUN_ID,
    organization_id: "org",
    repo_ref: HELIOS,
    analyzer: "change_point",
    analyzer_version: 1,
    finding_type: "change_point",
    subject_key: "build.duration_median@2026-06-22",
    identity_key: "change_point@v1/build.duration_median@2026-06-22",
    data: {
      date: "2026-06-22",
      metric: "build.duration_median",
      delta_seconds: -130,
      before_median_seconds: 342,
      after_median_seconds: 212,
      candidates: [
        {
          label: "ccache enabled",
          score: 0.7,
          ref: { kind: "merge", id: CCACHE_SHA },
          event_kind: "merge",
          date: "2026-06-22",
          days_from_breakpoint: 0,
          proximity: 1,
          prior: 0.7,
        },
        {
          label: "standard-fix v9",
          score: 0.3,
          ref: { kind: "workflow_version", id: POLICY_VERSION_ID },
          event_kind: "policy_version",
          date: "2026-06-21",
          days_from_breakpoint: -1,
          proximity: 0.75,
          prior: 0.4,
        },
      ],
    },
    evidence_refs: [
      { kind: "merge", id: CCACHE_SHA },
      { kind: "workflow_version", id: POLICY_VERSION_ID },
      { kind: "build", id: LAST_BEFORE_ID },
      { kind: "build", id: FIRST_AFTER_ID },
    ],
    confidence: 100,
    confidence_basis: {
      method:
        "change_point v1: 100 * stability * (1 - e^(-effect/2)) * min(1, shorter segment days / (2 * min_segment_days))",
      sample_size: 642,
      effect_size: 17.537,
      stability: 1,
    },
    created_at: new Date("2026-08-08T10:06:00Z"),
    ...overrides,
  };
}

/**
 * What the finding's references name: the merge on its mirrored PR, the workflow version, and the
 * first of the two builds — the second has been removed by retention.
 *
 * @param overrides - Kinds to replace.
 * @returns The resolution.
 */
export function resolvedEvidence(overrides: Partial<ResolvedEvidence> = {}): ResolvedEvidence {
  return {
    builds: [{ id: LAST_BEFORE_ID, number: 641, label: "zephyr build" }],
    merges: [
      {
        sha: CCACHE_SHA,
        title: "ccache enabled",
        pull_request_id: "5eed0052-0000-4000-8000-000000000482",
      },
    ],
    workflowVersions: [{ id: POLICY_VERSION_ID, slug: "standard-fix", version: 9 }],
    runnerPools: [],
    runners: [],
    testRuns: [],
    testCases: [],
    waivers: [],
    ...overrides,
  };
}
