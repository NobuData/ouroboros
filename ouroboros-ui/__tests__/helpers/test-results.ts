import type {
  RerunAvailability,
  TestAttempt,
  TestCaseResult,
  TestRunPage,
  TestRunTimeline,
  TestStrip,
  TestSuiteResult,
} from "@/app/api/test-results";

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
