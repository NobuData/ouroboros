import type {
  CaseHint,
  RerunAvailability,
  TestArtifact,
  TestAttempt,
  TestCaseFailureDetail,
  TestCaseResult,
  TestCoverage,
  TestRunHints,
  TestRunPage,
  TestRunTimeline,
  TestStrip,
  TestSuiteResult,
} from "@/app/api/test-results";

import type { Measurement, PhysicalCase } from "@/app/test-results/physical";

import { SEEDED_RUN_ID } from "./runs";

/**
 * The seeded `#482`'s test results (#335) as AT.5's timeline states them — mockup 11's figures:
 * Build 3 at `61/63 passed`, `▲ 12` measured against Build 1 (#333's decision 1), one HIL failure,
 * one flaky case the quarantine is watching, and a `6m 12s` wall time split `4m sim · 2m 12s
 * physical`.
 */

/** Build 1's id. */
export const BUILD_1_ID = "5eed0033-0000-4000-8000-000000000001";

/** Build 2's id. */
export const BUILD_2_ID = "5eed0033-0000-4000-8000-000000000002";

/** Build 3's id — the latest, and the page's default. */
export const BUILD_3_ID = "5eed0033-0000-4000-8000-000000000003";

/** The failing HIL case. */
export const OVERSHOOT_CASE = {
  caseId: "5eed0035-0000-4000-8000-000000000001",
  name: "pid_overshoot_under_load",
  suite: "PHYSICAL · HIL rig",
  physical: true,
} as const;

/** The flaky case. */
export const FLAKY_CASE = {
  caseId: "5eed0035-0000-4000-8000-000000000002",
  name: "can_frame_roundtrip",
  suite: "telemetry",
  physical: false,
  passedOnRetry: 2,
  attempts: 3,
  flakeState: "watching",
} as const;

/**
 * A strip.
 *
 * @param over What to change.
 * @returns Build 3's strip, changed.
 */
export function strip(over: Partial<TestStrip> = {}): TestStrip {
  return {
    total: 63,
    suiteCount: 5,
    passed: 61,
    passedDelta: { value: 12, versusAttemptSeq: 1, versusTestRunId: BUILD_1_ID },
    failed: 1,
    failedCases: [OVERSHOOT_CASE],
    flaky: 1,
    flakyCases: [FLAKY_CASE],
    skipped: 0,
    wallTime: { wallMs: 372_000, simMs: 240_000, physicalMs: 132_000 },
    ...over,
  };
}

/**
 * An attempt.
 *
 * @param attemptSeq Its ordinal.
 * @param over What to change.
 * @returns The attempt, on `forge-01` and `helios-rig-02`.
 */
export function attempt(attemptSeq: number, over: Partial<TestAttempt> = {}): TestAttempt {
  const ids = [BUILD_1_ID, BUILD_2_ID, BUILD_3_ID];

  return {
    id: ids[attemptSeq - 1] ?? `5eed0033-0000-4000-8000-00000000000${attemptSeq}`,
    attemptSeq,
    status: "complete",
    commitSha: "f42b9a0",
    startedAt: "2026-09-19T14:38:19.000Z",
    lastReceivedAt: "2026-09-19T14:44:31.000Z",
    selection: null,
    build: { jobId: "7f000002-0000-4000-8000-000000000479", number: 479, runner: "forge-01" },
    rigs: ["helios-rig-02"],
    strip: strip(),
    ...over,
  };
}

/**
 * The seeded run's three attempts.
 *
 * @returns Build 1 (fourteen failures), Build 2 and Build 3, oldest first.
 */
export function seededAttempts(): TestAttempt[] {
  return [
    attempt(1, {
      strip: strip({
        passed: 49,
        passedDelta: null,
        failed: 14,
        flaky: 0,
        flakyCases: [],
        wallTime: { wallMs: 401_000, simMs: 263_000, physicalMs: 138_000 },
      }),
    }),
    attempt(2, {
      selection: "failed",
      strip: strip({
        passedDelta: { value: 12, versusAttemptSeq: 1, versusTestRunId: BUILD_1_ID },
        wallTime: { wallMs: 355_000, simMs: 228_000, physicalMs: 127_000 },
      }),
    }),
    attempt(3, { selection: "failed" }),
  ];
}

/**
 * The seeded run's three attempts as mockup 11's timeline draws them (#336): Build 1 a mass
 * failure, Build 2 a near-fix, and Build 3 the re-run of the failed set, still in flight — each
 * with the mockup's own timestamp and sha.
 *
 * @returns Build 1 (err), Build 2 (warn) and Build 3 (live), oldest first.
 */
export function mockupAttempts(): TestAttempt[] {
  const [one, two, three] = seededAttempts();

  return [
    { ...one!, commitSha: "a3f19c2", startedAt: "2026-09-19T13:52:41.000Z" },
    {
      ...two!,
      commitSha: "c81d4e7",
      startedAt: "2026-09-19T14:21:07.000Z",
      strip: { ...two!.strip, failed: 2 },
    },
    { ...three!, status: "running", commitSha: "f42b9a0", startedAt: "2026-09-19T14:38:19.000Z" },
  ];
}

/**
 * The timeline.
 *
 * @param over What to change.
 * @returns The seeded run's timeline.
 */
export function timeline(over: Partial<TestRunTimeline> = {}): TestRunTimeline {
  const attempts = over.attempts ?? seededAttempts();

  return {
    run: {
      id: SEEDED_RUN_ID,
      issueNumber: 482,
      issueTitle: "Fix flaky CAN-bus telemetry test",
      loopSeq: 1847,
      branch: "loop/482-canbus-flake",
      workflowTag: "standard-fix",
      workflowVersionPin: 14,
      startedAt: "2026-09-19T13:50:00.000Z",
    },
    attempts,
    latestTestRunId: attempts.at(-1)?.id ?? null,
    next: {
      action: "publish_to_pr",
      pullRequest: { number: 514, url: "https://github.com/acme-robotics/helios-firmware/pull/514" },
      gatedOn: { passed: 63, total: 63 },
      activation: "gate_armed",
      intents: { blockUntilGreen: true, autoRerunPhysical: false },
      gate: { required: true, source: "standard-fix v14" },
    },
    ...over,
  };
}

/**
 * A re-run gate.
 *
 * @param over What to change.
 * @returns Build 3's gate: a runner is available, one failed case, sixty-three in all.
 */
export function gate(over: Partial<RerunAvailability> = {}): RerunAvailability {
  return {
    testRunId: BUILD_3_ID,
    readiness: "runner_available",
    pool: "hil",
    failedCases: 1,
    fullCases: 63,
    ...over,
  };
}

/** The id of `telemetry integration` in Build 3. */
export const TELEMETRY_SUITE_ID = "5eed0032-0000-4000-8000-000000048302";

/** The id of `PHYSICAL · HIL rig` in Build 3. */
export const HIL_SUITE_ID = "5eed0032-0000-4000-8000-000000048305";

/**
 * A case.
 *
 * @param over What to change.
 * @returns A case that passed first time in 412 ms, changed.
 */
export function testCase(over: Partial<TestCaseResult> = {}): TestCaseResult {
  return {
    id: "5eed0035-0000-4000-8000-000000000100",
    caseKey: "a".repeat(64),
    name: "case_01",
    classname: null,
    status: "passed",
    retries: 0,
    retryOutcomes: ["passed"],
    durationMs: 412,
    hasFailure: false,
    flake: null,
    ...over,
  };
}

/**
 * A suite.
 *
 * @param over What to change.
 * @returns `unit · drivers` on `native_sim`, 24/24 with no case listed, changed.
 */
export function suite(over: Partial<TestSuiteResult> = {}): TestSuiteResult {
  return {
    id: "5eed0032-0000-4000-8000-000000048301",
    name: "unit · drivers",
    platform: "native_sim",
    kind: "sim",
    resultsFormat: "junit",
    rig: null,
    bench: null,
    counts: { total: 24, passed: 24, failed: 0, flaky: 0, skipped: 0 },
    cases: [],
    ...over,
  };
}

/**
 * Build 3's five suites, as mockup 11 draws them (#337): the flaky case in `telemetry
 * integration` (`failed, failed, passed` — `retry 2/3`) and the overshoot failure on the rig.
 *
 * @returns The suites, in the mockup's order.
 */
export function seededSuites(): TestSuiteResult[] {
  return [
    suite(),
    suite({
      id: TELEMETRY_SUITE_ID,
      name: "telemetry integration",
      platform: "qemu_cortex_m3",
      counts: { total: 19, passed: 18, failed: 0, flaky: 1, skipped: 0 },
      cases: [
        testCase({ id: "5eed0035-0000-4000-8000-000000000201", name: "can_frame_order" }),
        testCase({
          id: FLAKY_CASE.caseId,
          name: FLAKY_CASE.name,
          status: "flaky",
          retries: 2,
          retryOutcomes: ["failed", "failed", "passed"],
          durationMs: 3100,
          hasFailure: true,
        }),
      ],
    }),
    suite({
      id: "5eed0032-0000-4000-8000-000000048303",
      name: "motor control",
      platform: "qemu_cortex_m3",
      counts: { total: 12, passed: 12, failed: 0, flaky: 0, skipped: 0 },
    }),
    suite({
      id: "5eed0032-0000-4000-8000-000000048304",
      name: "OTA update",
      counts: { total: 6, passed: 6, failed: 0, flaky: 0, skipped: 0 },
    }),
    suite({
      id: HIL_SUITE_ID,
      name: "PHYSICAL · HIL rig",
      platform: "rig:helios-rig-02",
      kind: "physical",
      resultsFormat: "hil",
      rig: "helios-rig-02",
      bench: "CAN bus + motor + power-cycler",
      counts: { total: 2, passed: 1, failed: 1, flaky: 0, skipped: 0 },
      cases: [
        testCase({
          id: OVERSHOOT_CASE.caseId,
          name: OVERSHOOT_CASE.name,
          status: "failed",
          retryOutcomes: ["failed"],
          durationMs: 61_000,
          hasFailure: true,
        }),
        testCase({ id: "5eed0035-0000-4000-8000-000000000502", name: "power_loss_recovery", durationMs: null }),
      ],
    }),
  ];
}

/**
 * An attempt's page.
 *
 * @param over What to change.
 * @returns Build 3's page, with the seeded suites.
 */
export function page(over: Partial<TestRunPage> = {}): TestRunPage {
  return {
    runId: SEEDED_RUN_ID,
    testRun: attempt(3, { selection: "failed" }),
    parseWarnings: [],
    suites: seededSuites(),
    physical: [],
    classifications: [],
    artifacts: [],
    coverage: null,
    ...over,
  };
}

/** The id of the frame-order case on the rig in Build 3. */
export const FRAME_ORDER_CASE_ID = "5eed0035-0000-4000-8000-000000000503";

/** The id of the beacon case on the rig in Build 3. */
export const BEACON_CASE_ID = "5eed0035-0000-4000-8000-000000000504";

/** The id of the power-loss case on the rig in Build 3. */
export const POWER_LOSS_CASE_ID = "5eed0035-0000-4000-8000-000000000502";

/** The id of the overshoot measurement. */
export const MEASUREMENT_ID = "5eed0036-0000-4000-8000-000000000001";

/**
 * A measurement.
 *
 * @param over What to change.
 * @returns The overshoot — `2.4 %` against a `max` of `2.0`, failed, with no comparative — changed.
 */
export function measurement(over: Partial<Measurement> = {}): Measurement {
  return {
    id: MEASUREMENT_ID,
    metric: "overshoot_pct",
    value: 2.4,
    unit: "%",
    limit: 2,
    limitKind: "max",
    verdict: "fail",
    comparative: null,
    trials: 3,
    ...over,
  };
}

/**
 * A measured case.
 *
 * @param over What to change.
 * @returns The overshoot case on the HIL suite, changed.
 */
export function physicalCase(over: Partial<PhysicalCase> = {}): PhysicalCase {
  return {
    caseId: OVERSHOOT_CASE.caseId,
    name: "Motor overshoot on e-stop release",
    classname: null,
    suiteId: HIL_SUITE_ID,
    status: "failed",
    procedure: "dyno bench releases e-stop under 2 Nm load, 3 trials",
    measurements: [measurement()],
    ...over,
  };
}

/**
 * Mockup 11's four physical rows (#338), as stored fields: each one a case of the HIL suite and
 * its measurement. The frame order alone carries a comparative — Build 1 measured 37.
 *
 * @returns The four measured cases, in the mockup's order.
 */
export function mockupPhysical(): PhysicalCase[] {
  return [
    physicalCase({
      caseId: POWER_LOSS_CASE_ID,
      name: "Power-loss mid-flash recovery",
      status: "passed",
      procedure: "power-cycler kills 24V rail at 40 / 60 / 80% of OTA write",
      measurements: [
        measurement({ metric: "slot_b_fallback_ms", value: 412, unit: "ms", limit: 500, verdict: "pass" }),
      ],
    }),
    physicalCase({
      caseId: FRAME_ORDER_CASE_ID,
      name: "CAN bus frame order under 90% load",
      status: "passed",
      procedure: "traffic generator floods bus at 900 kbit/s for 60s",
      measurements: [
        measurement({
          metric: "reordered_frames",
          value: 0,
          unit: "count",
          limit: 0,
          verdict: "pass",
          comparative: "was 37 in build 1",
          trials: 1,
        }),
      ],
    }),
    physicalCase(),
    physicalCase({
      caseId: BEACON_CASE_ID,
      name: "BLE beacon in dual-slot-corrupt state",
      status: "passed",
      procedure: "both firmware slots checksum-corrupted deliberately, cold boot",
      measurements: [
        measurement({ metric: "recovery_beacon_s", value: 1.8, unit: "s", limit: 3, verdict: "pass" }),
      ],
    }),
  ];
}

/**
 * The HIL suite with the mockup's four cases (#338), to go with {@link mockupPhysical}.
 *
 * @param over What to change.
 * @returns The suite, 3/4, on `rig:helios-rig-02`.
 */
export function mockupRigSuite(over: Partial<TestSuiteResult> = {}): TestSuiteResult {
  return suite({
    id: HIL_SUITE_ID,
    name: "PHYSICAL · HIL rig",
    platform: "rig:helios-rig-02",
    kind: "physical",
    resultsFormat: "hil",
    rig: "helios-rig-02",
    bench: "CAN bus + motor + power-cycler",
    counts: { total: 4, passed: 3, failed: 1, flaky: 0, skipped: 0 },
    cases: mockupPhysical().map((each) =>
      testCase({
        id: each.caseId,
        name: each.name,
        status: each.status,
        retryOutcomes: [each.status === "failed" ? "failed" : "passed"],
        hasFailure: each.status === "failed",
      }),
    ),
    ...over,
  });
}

/**
 * Build 3's page as mockup 11 draws its physical card (#338): the four simulated suites, and the
 * rig's suite with its four measured cases.
 *
 * @param over What to change.
 * @returns The page.
 */
export function mockupPage(over: Partial<TestRunPage> = {}): TestRunPage {
  return page({
    suites: [...seededSuites().filter((each) => each.kind !== "physical"), mockupRigSuite()],
    physical: mockupPhysical(),
    ...over,
  });
}

/** The id of `junit-build3.xml` in Build 3. */
export const JUNIT_ARTIFACT_ID = "5eed0038-0000-4000-8000-000000048231";

/** The id of `rig-capture-estop.csv` in Build 3. */
export const CAPTURE_ARTIFACT_ID = "5eed0038-0000-4000-8000-000000048232";

/** The id of `serial-console.log` in Build 3. */
export const LOG_ARTIFACT_ID = "5eed0038-0000-4000-8000-000000048233";

/** The id of `coverage.info` in Build 3. */
export const COVERAGE_ARTIFACT_ID = "5eed0038-0000-4000-8000-000000048234";

/**
 * An attempt's coverage.
 *
 * @param over What to change.
 * @returns Build 3's — `87.4%`, `+0.6` against Build 2 — changed.
 */
export function coverage(over: Partial<TestCoverage> = {}): TestCoverage {
  return { percent: 87.4, linesCovered: 4475, linesTotal: 5120, delta: 0.6, versusAttemptSeq: 2, ...over };
}

/**
 * A first attempt's coverage: no earlier one to measure against, so no delta at all.
 *
 * @returns `86.8%`, with neither `delta` nor `versusAttemptSeq`.
 */
export function firstCoverage(): TestCoverage {
  return { percent: 86.8, linesCovered: 4444, linesTotal: 5120 };
}

/**
 * An artifact.
 *
 * @param over What to change. An `expired` state that names no `href` is given none.
 * @returns `junit-build3.xml` — 48 KB, live, whole, read inline, kept thirty days — changed.
 */
export function artifact(over: Partial<TestArtifact> = {}): TestArtifact {
  const id = over.id ?? JUNIT_ARTIFACT_ID;
  const expired = over.state === "expired";

  return {
    id,
    name: "junit-build3.xml",
    kind: "junit",
    sizeBytes: 48_213,
    checksum: `sha256:${"0".repeat(64)}`,
    createdAt: "2026-09-19T14:45:00.000Z",
    retainedUntil: "2026-10-19T14:45:00.000Z",
    retentionDays: 30,
    state: "available",
    expiredAt: expired ? "2026-10-19T15:00:00.000Z" : null,
    truncated: false,
    truncationNote: null,
    preview: "inline",
    href: expired ? null : `/api/v1/artifacts/${id}`,
    coverage: null,
    ...over,
  };
}

/**
 * Build 3's four artifacts, as mockup 11 draws them (#341) and AT.5's seed states them.
 *
 * @returns `junit-build3.xml`, `rig-capture-estop.csv` (2.1 MB, a download), `serial-console.log`
 *   and the coverage report carrying `87.4% (+0.6%)`.
 */
export function mockupArtifacts(): TestArtifact[] {
  return [
    artifact(),
    artifact({
      id: CAPTURE_ARTIFACT_ID,
      name: "rig-capture-estop.csv",
      kind: "capture",
      sizeBytes: 2_202_010,
      preview: "download",
    }),
    artifact({ id: LOG_ARTIFACT_ID, name: "serial-console.log", kind: "log", sizeBytes: 184_320 }),
    artifact({
      id: COVERAGE_ARTIFACT_ID,
      name: "coverage.info",
      kind: "coverage",
      sizeBytes: 91_822,
      coverage: coverage(),
    }),
  ];
}

/** The overshoot failure's path, as the seed states it. */
export const OVERSHOOT_PATH = "tests/hil/test_estop_release.py";

/** The overshoot failure's assertion. */
export const OVERSHOOT_MESSAGE = "AssertionError: max overshoot 2.4% > limit 2.0%";

/** The overshoot failure's log excerpt, as the seed states it — mockup 11's six lines. */
export const OVERSHOOT_LOG = [
  "[rig] e-stop released @ 2.00 Nm · setpoint 1200 rpm",
  "[rig] trial 1: peak 1225.2 rpm  → overshoot 2.1%",
  "[rig] trial 2: peak 1228.8 rpm  → overshoot 2.4%",
  "[rig] trial 3: peak 1227.6 rpm  → overshoot 2.3%",
  "[rig] settle time 84ms · velocity sample lag +0.4ms",
  `E   ${OVERSHOOT_MESSAGE}`,
].join("\n");

/**
 * A case's failure payload (#339).
 *
 * @param over What to change.
 * @returns Mockup 11's failure — `overshoot_under_load` on the rig in Build 3 — changed.
 */
export function caseFailure(over: Partial<TestCaseFailureDetail> = {}): TestCaseFailureDetail {
  return {
    testRunId: BUILD_3_ID,
    caseId: OVERSHOOT_CASE.caseId,
    caseKey: "b".repeat(64),
    name: "overshoot_under_load",
    classname: null,
    suite: "PHYSICAL · HIL rig",
    platform: "rig:helios-rig-02",
    status: "failed",
    retryOutcomes: ["failed"],
    message: OVERSHOOT_MESSAGE,
    logExcerpt: OVERSHOOT_LOG,
    path: OVERSHOOT_PATH,
    ...over,
  };
}

/** Why the seeded hint's rule fired, in the service's sentence. */
export const OVERSHOOT_REASON = `New since the previous attempt, in ${OVERSHOOT_PATH}, which this run changed.`;

/**
 * One failing case's hint entry (#339, as AT.4 answers it).
 *
 * @param over What to change.
 * @returns The overshoot case's: `product.new_failure_in_diff` suggesting a product bug, by the
 *   `heuristic` actor, with no confidence, no narrative and no model — changed.
 */
export function caseHint(over: Partial<CaseHint> = {}): CaseHint {
  return {
    caseId: OVERSHOOT_CASE.caseId,
    caseKey: "b".repeat(64),
    name: "overshoot_under_load",
    suite: "PHYSICAL · HIL rig",
    status: "failed",
    hint: {
      suggestedClass: "product_bug",
      ruleId: "product.new_failure_in_diff",
      actor: "heuristic",
      reason: OVERSHOOT_REASON,
    },
    rules: [],
    triage: {
      class: "product_bug",
      subtype: null,
      confidence: null,
      narrative: null,
      evidence: [],
      provenance: {
        contract: "triage/v0",
        actor: "heuristic",
        rule_id: "product.new_failure_in_diff",
        model: null,
      },
    },
    ...over,
  };
}

/** Mockup 11's narrative — what AV.1's model (#343) will answer. */
export const MODEL_NARRATIVE =
  "The k_msgq change in build 2 added ~0.4ms latency on the telemetry path, which delays the PID loop's velocity sample by one tick. Overshoot regression, not a test artifact — classify as product bug.";

/** Mockup 11's model pill. */
export const MODEL_NAME = "claude-fable-5";

/**
 * A hint entry as AV.1's model (#343) will answer it: the same shape, by the `model` actor.
 *
 * @param over What to change in the `/v0/triage` answer.
 * @returns The overshoot case's entry, its triage a model's — a narrative, 84, and the model.
 */
export function modelHint(over: Partial<NonNullable<CaseHint["triage"]>> = {}): CaseHint {
  return caseHint({
    triage: {
      class: "product_bug",
      subtype: null,
      confidence: 84,
      narrative: MODEL_NARRATIVE,
      evidence: [],
      provenance: { contract: "triage/v0", actor: "model", rule_id: null, model: MODEL_NAME },
      ...over,
    },
  });
}

/**
 * An attempt's triage hints (#339).
 *
 * @param cases The entries. Defaults to the overshoot case's heuristic hint.
 * @returns Build 3's hints.
 */
export function hints(cases: readonly CaseHint[] = [caseHint()]): TestRunHints {
  return { testRunId: BUILD_3_ID, cases: [...cases] };
}
