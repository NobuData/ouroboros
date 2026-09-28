import type {
  RerunAvailability,
  TestAttempt,
  TestRunTimeline,
  TestStrip,
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
