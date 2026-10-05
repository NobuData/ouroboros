/**
 * Mockup 11's `#482`, as the rows the reads see (AT.5, #333) — the unit suites' universe.
 *
 * The figures are `R__dev_seed_test_results.sql`'s and `R__dev_seed_verification.sql`'s: Build 1
 * `49/63 · 14 failed`, Build 2 `61/63 · 2 failed`, Build 3 the re-run of the failed set
 * (`61 passed · 1 failed · 1 flaky`, `4m sim · 2m 12s physical`), Build 4 `63/63`; the rig's
 * overshoot `2.4% vs limit 2.0%` and frame order `0 (was 37 in build 1)`; the telemetry case
 * `watching`; four artifacts and coverage `87.4% (+0.6%)`; PR #514 with its `test_suite` gate.
 *
 * {@link FakeResultsRepository} answers the repository's reads from these rows, scoped by
 * workspace exactly as the statements are, so the isolation cases mean something.
 */

import { cutoffOf, type RetentionCutoffs } from "../retention/retention.cutoffs";
import type { ClassificationRow } from "../triage/triage.repository";
import type {
  ArtifactRow,
  AttemptRow,
  CaseRow,
  CoverageRow,
  ExpiringArtifact,
  FlakeRow,
  IntentRow,
  MeasurementRow,
  PullRequestRow,
  RunRow,
  SuiteRow,
} from "./results.repository";
import type { TestCaseStatus } from "../db/schema";

export const ORG = "0rg00000-0000-4000-8000-000000000001";
export const OTHER_ORG = "0rg00000-0000-4000-8000-000000000002";
export const REPO = "7e900000-0000-4000-8000-000000000001";
export const RUN = "5eed0010-0000-4000-8000-000000000482";

/** `test_runs.id` of `#482`'s Build `n`. */
export function attemptId(n: number): string {
  return `5eed0031-0000-4000-8000-00000000482${String(n)}`;
}

/** A case id, unique per attempt, suite and ordinal. */
function caseId(attempt: number, suite: number, n: number): string {
  return `5eed0033-0000-4000-8000-0000482${String(attempt)}${String(suite).padStart(2, "0")}${String(n).padStart(2, "0")}`;
}

/**
 * A measurement's id — `hil_measurements.id`.
 *
 * @param attempt - The attempt's ordinal.
 * @param n - The measurement's ordinal within the attempt.
 * @returns The uuid.
 */
export function measurementId(attempt: number, n: number): string {
  return `5eed0035-0000-4000-8000-0000482${String(attempt)}00${String(n).padStart(2, "0")}`;
}

/** A 64-hex case key, the same in every attempt. */
function caseKey(suite: number, n: number): string {
  return `${String(suite).padStart(2, "0")}${String(n).padStart(2, "0")}`.padEnd(64, "a");
}

export const T0 = new Date("2026-09-20T13:48:00.000Z");

/** Minutes after the run started. */
function at(minutes: number): Date {
  return new Date(T0.getTime() + minutes * 60_000);
}

export const RUN_ROW: RunRow = {
  id: RUN,
  github_repo_id: REPO,
  issue_number: 482,
  issue_title: "Fix flaky CAN-bus telemetry test",
  loop_seq: 1847,
  branch_name: "loop/482-canbus-flake",
  workflow_tag: "standard-fix",
  workflow_version_pin: 14,
  started_at: T0,
};

/** The five suites: name, platform, kind, format, case count, bench. */
const SUITES = [
  { name: "unit · drivers", platform: "native_sim", kind: "sim", format: "junit", cases: 24 },
  {
    name: "telemetry integration",
    platform: "qemu_cortex_m3",
    kind: "sim",
    format: "junit",
    cases: 19,
  },
  { name: "motor control", platform: "qemu_cortex_m3", kind: "sim", format: "junit", cases: 12 },
  { name: "OTA update", platform: "native_sim", kind: "sim", format: "junit", cases: 6 },
  {
    name: "PHYSICAL · HIL rig",
    platform: "rig:helios-rig-02",
    kind: "physical",
    format: "hil",
    cases: 2,
  },
] as const;

/** Build 1's fourteen failures, by suite and ordinal. */
const BUILD_1_FAILURES: ReadonlyArray<readonly [number, number]> = [
  [1, 16],
  [2, 1],
  [2, 2],
  [2, 3],
  [2, 5],
  [2, 6],
  [2, 7],
  [2, 9],
  [2, 14],
  [2, 15],
  [3, 4],
  [3, 6],
  [5, 1],
  [5, 2],
];

/** A non-passing outcome. */
interface Outcome {
  readonly status: TestCaseStatus;
  readonly outcomes: CaseRow["retry_outcomes"];
  readonly failure: CaseRow["failure"];
}

/** Overshoot's failure, with Build 3's log block. */
const OVERSHOOT_FAILURE = {
  message: "AssertionError: max overshoot 2.4% > limit 2.0%",
  path: "tests/hil/test_estop_release.py",
  log_excerpt:
    "[rig] e-stop released @ 2.00 Nm · setpoint 1200 rpm\n[rig] trial 2: peak 1228.8 rpm → overshoot 2.4%",
};

/**
 * What a case did in an attempt — undefined for a first-time pass.
 *
 * @param attempt - Build 1–4.
 * @param suite - 1–5.
 * @param n - The ordinal.
 * @returns The outcome.
 */
function outcomeOf(attempt: number, suite: number, n: number): Outcome | undefined {
  const failed = (failure: CaseRow["failure"]): Outcome => ({
    status: "failed",
    outcomes: ["failed"],
    failure,
  });

  if (attempt === 1 && BUILD_1_FAILURES.some(([s, i]) => s === suite && i === n)) {
    return suite === 5 && n === 1 ? failed(OVERSHOOT_FAILURE) : failed({ message: "failed" });
  }
  if (attempt === 2 && suite === 2 && n === 3) {
    return {
      status: "failed",
      outcomes: ["failed", "failed", "failed"],
      failure: { message: "x" },
    };
  }
  if ((attempt === 2 || attempt === 3) && suite === 5 && n === 1) return failed(OVERSHOOT_FAILURE);
  if (attempt === 3 && suite === 2 && n === 3) {
    return {
      status: "flaky",
      outcomes: ["failed", "failed", "passed"],
      failure: { message: "ring buffer not drained within 50 ms (attempts 1 and 2)" },
    };
  }
  return undefined;
}

/** Everything the fake answers from. Tests mutate copies. */
export interface Universe {
  runs: (RunRow & { organization_id: string })[];
  attempts: (AttemptRow & { organization_id: string })[];
  suites: (SuiteRow & { organization_id: string })[];
  cases: (CaseRow & { organization_id: string })[];
  measurements: (MeasurementRow & { organization_id: string; test_run_id: string })[];
  flakes: (FlakeRow & { organization_id: string; github_repo_id: string })[];
  classifications: (ClassificationRow & { organization_id: string; test_run_id: string })[];
  coverage: (CoverageRow & { organization_id: string; test_run_id: string })[];
  intents: (IntentRow & { organization_id: string; run_id: string })[];
  pullRequests: (PullRequestRow & { organization_id: string; run_id: string })[];
  artifacts: ArtifactRow[];
}

/**
 * Build `#482`'s universe.
 *
 * @returns Fresh rows.
 */
export function mockupUniverse(): Universe {
  const universe: Universe = {
    runs: [{ ...RUN_ROW, organization_id: ORG }],
    attempts: [],
    suites: [],
    cases: [],
    measurements: [],
    flakes: [],
    classifications: [],
    coverage: [],
    intents: [
      { organization_id: ORG, run_id: RUN, block_until_green: true, auto_rerun_physical: true },
    ],
    pullRequests: [
      {
        organization_id: ORG,
        run_id: RUN,
        id: "5eed003a-0000-4000-8000-000000000514",
        external_number: 514,
        external_url: "https://github.com/acme-robotics/helios-firmware/pull/514",
        gate_required: true,
        gate_source: "standard-fix@v14 pin",
      },
    ],
    artifacts: [],
  };

  const commits = ["a3f19c2", "c81d4e7", "f42b9a0", "b7e41d0"];
  for (const attempt of [1, 2, 3, 4]) {
    const testRunId = attemptId(attempt);
    let counts = { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 };

    SUITES.forEach((suite, index) => {
      const suiteNo = index + 1;
      const suiteId = `5eed0032-0000-4000-8000-000000048${String(attempt)}${String(suiteNo).padStart(2, "0")}`;
      const own = { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 };

      for (let n = 1; n <= suite.cases; n += 1) {
        const outcome = attempt === 4 ? undefined : outcomeOf(attempt, suiteNo, n);
        const status = outcome?.status ?? "passed";
        own.total += 1;
        if (status === "passed") own.passed += 1;
        if (status === "failed") own.failed += 1;
        if (status === "flaky") own.flaky += 1;

        universe.cases.push({
          organization_id: ORG,
          id: caseId(attempt, suiteNo, n),
          test_run_id: testRunId,
          test_suite_id: suiteId,
          case_key: caseKey(suiteNo, n),
          name:
            suiteNo === 5
              ? ["overshoot_under_load", "frame_order_under_load"][n - 1]
              : `case ${String(n)}`,
          classname:
            suiteNo === 5
              ? ["tests/hil/test_estop_release.py", "tests/hil/test_can_frame_order.py"][n - 1]
              : "suite",
          status,
          retries: (outcome?.outcomes.length ?? 1) - 1,
          retry_outcomes: outcome?.outcomes ?? ["passed"],
          duration_ms: "120",
          failure: outcome?.failure ?? null,
          suite: suite.name,
          platform: suite.platform,
          suite_kind: suite.kind,
        });
      }

      universe.suites.push({
        organization_id: ORG,
        id: suiteId,
        test_run_id: testRunId,
        name: suite.name,
        platform: suite.platform,
        kind: suite.kind,
        results_format: suite.format,
        ...own,
        meta: suite.kind === "physical" ? { bench: "CAN bus + motor + power-cycler" } : {},
      });
      counts = {
        total: counts.total + own.total,
        passed: counts.passed + own.passed,
        failed: counts.failed + own.failed,
        flaky: counts.flaky + own.flaky,
        skipped: 0,
      };
    });

    universe.attempts.push({
      organization_id: ORG,
      id: testRunId,
      run_id: RUN,
      attempt_seq: attempt,
      status: attempt === 3 ? "running" : "complete",
      commit_sha: commits[attempt - 1],
      started_at: at([4.68, 5.58, 6.47, 6.5][attempt - 1]),
      updated_at: at([5.2, 6.1, 6.49, 6.9][attempt - 1]),
      ...counts,
      wall_ms: attempt === 3 ? "372000" : null,
      sim_ms: attempt === 3 ? "240000" : null,
      physical_ms: attempt === 3 ? "132000" : null,
      parse_warnings: [],
      build_job_id: null,
      job_number: null,
      job_status: null,
      test_selection: null,
      runner_name: null,
    });

    const overshoot = attempt === 4 ? "1.7" : "2.4";
    universe.measurements.push(
      {
        id: measurementId(attempt, 1),
        organization_id: ORG,
        test_run_id: testRunId,
        test_case_id: caseId(attempt, 5, 1),
        procedure: "dyno bench releases e-stop under 2 Nm load, 3 trials",
        metric: "overshoot_pct",
        value: overshoot,
        unit: "%",
        limit_value: "2.0",
        limit_kind: "max",
        verdict: attempt === 4 ? "pass" : "fail",
        context: null,
        trials: [{ trial: 1 }, { trial: 2 }, { trial: 3 }],
      },
      {
        id: measurementId(attempt, 2),
        organization_id: ORG,
        test_run_id: testRunId,
        test_case_id: caseId(attempt, 5, 2),
        procedure: "traffic generator floods bus at 900 kbit/s for 60s",
        metric: "reordered_frames",
        value: attempt === 1 ? "37" : "0",
        unit: "count",
        limit_value: "0",
        limit_kind: "max",
        verdict: attempt === 1 ? "fail" : "pass",
        context: attempt === 1 ? null : "was 37 in build 1",
        trials: [{ trial: 1 }],
      },
    );
  }

  universe.flakes.push({
    organization_id: ORG,
    github_repo_id: REPO,
    case_key: caseKey(2, 3),
    state: "watching",
    score: "0.5028",
    window_runs: 4,
    formula_version: 1,
  });

  universe.classifications.push({
    organization_id: ORG,
    test_run_id: attemptId(3),
    id: "5eed0037-0000-4000-8000-000000000482",
    test_case_id: caseId(3, 5, 1),
    class: "product_bug",
    note: null,
    actor: "heuristic",
    rule_id: "hil.limit_exceeded",
    confidence: null,
    routed: null,
    created_by: null,
    created_at: at(12),
    superseded_by: null,
    subtype: null,
  });

  universe.coverage.push(
    {
      organization_id: ORG,
      test_run_id: attemptId(2),
      lines_covered: "4444",
      lines_total: "5120",
      percent: "86.8",
      previous_attempt_seq: null,
      delta: null,
    },
    {
      organization_id: ORG,
      test_run_id: attemptId(3),
      lines_covered: "4475",
      lines_total: "5120",
      percent: "87.4",
      previous_attempt_seq: 2,
      delta: "0.6",
    },
  );

  const artifacts: ReadonlyArray<readonly [number, number, string, ArtifactRow["kind"], number]> = [
    [2, 1, "coverage.info", "coverage", 90112],
    [3, 1, "junit-build3.xml", "junit", 48213],
    [3, 2, "rig-capture-estop.csv", "capture", 2202010],
    [3, 3, "serial-console.log", "log", 184320],
    [3, 4, "coverage.info", "coverage", 91822],
  ];
  for (const [attempt, ordinal, name, kind, size] of artifacts) {
    const created = at(10 + ordinal);
    universe.artifacts.push({
      id: `5eed0038-0000-4000-8000-0000000482${String(attempt)}${String(ordinal)}`,
      organization_id: ORG,
      test_run_id: attemptId(attempt),
      name,
      kind,
      size_bytes: String(size),
      storage_ref: { driver: "local", key: `${ORG}/482/${String(attempt)}/${name}` },
      checksum: `sha256:${"0".repeat(64)}`,
      retained_until: new Date(created.getTime() + 30 * 86_400_000),
      expired_at: null,
      truncated: false,
      truncation_note: null,
      created_at: created,
    });
  }

  return universe;
}

/** The reads over a {@link Universe}, scoped by workspace as the statements are. */
export class FakeResultsRepository {
  /** @param universe - The rows. */
  constructor(readonly universe: Universe = mockupUniverse()) {}

  run(organizationId: string, runId: string): Promise<RunRow | undefined> {
    return Promise.resolve(
      this.universe.runs.find((row) => row.organization_id === organizationId && row.id === runId),
    );
  }

  attempts(
    organizationId: string,
    filter: { runId: string } | { testRunId: string },
  ): Promise<AttemptRow[]> {
    return Promise.resolve(
      this.universe.attempts
        .filter((row) => row.organization_id === organizationId)
        .filter((row) =>
          "runId" in filter ? row.run_id === filter.runId : row.id === filter.testRunId,
        )
        .sort((a, b) => a.attempt_seq - b.attempt_seq),
    );
  }

  suites(organizationId: string, testRunIds: readonly string[]): Promise<SuiteRow[]> {
    return Promise.resolve(
      this.universe.suites
        .filter(
          (row) => row.organization_id === organizationId && testRunIds.includes(row.test_run_id),
        )
        .sort((a, b) => Number(a.kind === "physical") - Number(b.kind === "physical")),
    );
  }

  cases(
    organizationId: string,
    testRunIds: readonly string[],
    filter: { statuses?: readonly TestCaseStatus[]; caseId?: string } = {},
  ): Promise<CaseRow[]> {
    return Promise.resolve(
      this.universe.cases
        .filter(
          (row) =>
            row.organization_id === organizationId &&
            testRunIds.includes(row.test_run_id) &&
            (filter.statuses === undefined || filter.statuses.includes(row.status)) &&
            (filter.caseId === undefined || filter.caseId === row.id),
        )
        .sort(
          (a, b) =>
            a.suite.localeCompare(b.suite) ||
            a.platform.localeCompare(b.platform) ||
            a.name.localeCompare(b.name),
        ),
    );
  }

  measurements(organizationId: string, testRunId: string): Promise<MeasurementRow[]> {
    return Promise.resolve(
      this.universe.measurements.filter(
        (row) => row.organization_id === organizationId && row.test_run_id === testRunId,
      ),
    );
  }

  flakes(
    organizationId: string,
    githubRepoId: string,
    caseKeys: readonly string[],
  ): Promise<FlakeRow[]> {
    return Promise.resolve(
      this.universe.flakes.filter(
        (row) =>
          row.organization_id === organizationId &&
          row.github_repo_id === githubRepoId &&
          caseKeys.includes(row.case_key),
      ),
    );
  }

  classifications(organizationId: string, testRunId: string): Promise<ClassificationRow[]> {
    return Promise.resolve(
      this.universe.classifications.filter(
        (row) => row.organization_id === organizationId && row.test_run_id === testRunId,
      ),
    );
  }

  coverage(organizationId: string, testRunId: string): Promise<CoverageRow | undefined> {
    return Promise.resolve(
      this.universe.coverage.find(
        (row) => row.organization_id === organizationId && row.test_run_id === testRunId,
      ),
    );
  }

  intents(organizationId: string, runId: string): Promise<IntentRow | undefined> {
    return Promise.resolve(
      this.universe.intents.find(
        (row) => row.organization_id === organizationId && row.run_id === runId,
      ),
    );
  }

  pullRequest(organizationId: string, runId: string): Promise<PullRequestRow | undefined> {
    return Promise.resolve(
      this.universe.pullRequests.find(
        (row) => row.organization_id === organizationId && row.run_id === runId,
      ),
    );
  }

  artifacts(organizationId: string, testRunId: string): Promise<ArtifactRow[]> {
    return Promise.resolve(
      this.universe.artifacts.filter(
        (row) => row.organization_id === organizationId && row.test_run_id === testRunId,
      ),
    );
  }

  artifact(organizationId: string, artifactId: string): Promise<ArtifactRow | undefined> {
    return Promise.resolve(
      this.universe.artifacts.find(
        (row) => row.organization_id === organizationId && row.id === artifactId,
      ),
    );
  }

  expiring(cutoffs: RetentionCutoffs, driver: string, limit: number): Promise<ExpiringArtifact[]> {
    return Promise.resolve(
      this.universe.artifacts
        .filter(
          (row) =>
            row.expired_at === null &&
            row.created_at <= cutoffOf(cutoffs, row.organization_id) &&
            (row.storage_ref as { driver: string }).driver === driver,
        )
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .slice(0, limit),
    );
  }

  markExpired(artifact: ExpiringArtifact, now: Date): Promise<boolean> {
    const row = this.universe.artifacts.find((each) => each.id === artifact.id);
    if (row === undefined || row.expired_at !== null) return Promise.resolve(false);

    (row as { expired_at: Date | null }).expired_at = now;
    return Promise.resolve(true);
  }
}
