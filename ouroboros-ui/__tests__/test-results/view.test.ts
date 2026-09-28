import { describe, expect, it } from "vitest";

import type { Rerun } from "@/app/api/test-results";
import {
  GATE_CHECKING,
  NOT_REPORTED,
  PASS_RATIO_WARN_FLOOR,
  RERUN_FULL_LABEL,
  RERUN_PENDING,
  SEND_BACK_LABEL,
  VIEWER_REASON,
  actionsView,
  attemptOrdinal,
  attemptParam,
  failedCaption,
  flakyCaption,
  machineLine,
  passPill,
  passedDelta,
  readinessReason,
  rerunOutcome,
  selectedAttempt,
  stripView,
  testsEyebrow,
  testsHead,
  watchingLabel,
} from "@/app/test-results/view";

import {
  BUILD_2_ID,
  BUILD_3_ID,
  FLAKY_CASE,
  OVERSHOOT_CASE,
  attempt,
  gate,
  seededAttempts,
  strip,
  timeline,
} from "../helpers/test-results";

/**
 * The test-results frame's decisions (#335), without rendering: which attempt the page reads,
 * the head against mockup 11, the strip as the payload states it — no delta or split recomputed —
 * and the actions' honest gating.
 */

describe("the attempt", () => {
  it("reads ?attempt= as a whole ordinal from 1, and anything else as the latest", () => {
    expect(attemptParam("3")).toBe(3);
    expect(attemptParam(["2", "3"])).toBe(2);
    for (const junk of [undefined, null, "", "0", "-1", "1.5", "3a", " 3", "9999999"]) {
      expect(attemptParam(junk), String(junk)).toBeNull();
    }
  });

  it("selects the asked-for attempt, the latest when none was asked for or it does not exist", () => {
    const attempts = seededAttempts();

    expect(selectedAttempt(attempts, 2)?.id).toBe(BUILD_2_ID);
    expect(selectedAttempt(attempts, null)?.id).toBe(BUILD_3_ID);
    expect(selectedAttempt(attempts, 9)?.id).toBe(BUILD_3_ID);
    expect(selectedAttempt([], null)).toBeNull();
  });
});

describe("the head (mockup 11)", () => {
  it("composes the seeded head: eyebrow, headline, pin, pill, ordinal and machine line", () => {
    const run = timeline();

    expect(testsHead(run, run.attempts[2]!, "https://github.com/acme-robotics/helios-firmware/issues/482")).toEqual({
      eyebrow: "Test Results · Run #1847 · Build 3",
      headline: "#482 — Fix flaky CAN-bus telemetry test",
      trackerUrl: "https://github.com/acme-robotics/helios-firmware/issues/482",
      workflow: "standard-fix v14",
      pass: { label: "61/63 passed", tone: "warn", dot: undefined },
      ordinal: "build 3 of loop #1847",
      machine: "forge-01 + rig helios-rig-02 · 6m 12s",
    });
  });

  it("names the run alone before any attempt has reported", () => {
    const run = timeline({ attempts: [] });

    expect(testsEyebrow(1847, null)).toBe("Test Results · Run #1847");
    expect(testsHead(run, null, null)).toEqual(
      expect.objectContaining({ pass: null, ordinal: null, machine: null, trackerUrl: null }),
    );
  });

  it("colours the pass pill by ratio: ok for all, warn at or above the floor, err below it", () => {
    expect(passPill(attempt(4, { strip: strip({ passed: 63, failed: 0, flaky: 0 }) })).tone).toBe("ok");
    expect(passPill(attempt(3)).tone).toBe("warn");
    expect(passPill(attempt(1, { strip: strip({ passed: 49 }) })).tone).toBe("err");

    const atFloor = Math.ceil(100 * PASS_RATIO_WARN_FLOOR);
    expect(passPill(attempt(3, { strip: strip({ passed: atFloor, total: 100 }) })).tone).toBe("warn");
    expect(passPill(attempt(3, { strip: strip({ passed: atFloor - 1, total: 100 }) })).tone).toBe("err");
  });

  it("says a running attempt is running, pulsing, and an attempt with no cases says so", () => {
    expect(passPill(attempt(4, { status: "running", strip: strip({ passed: 12, total: 63 }) }))).toEqual({
      label: "12/63 passed · running",
      tone: "accent",
      dot: "pulse",
    });
    expect(passPill(attempt(4, { strip: strip({ passed: 0, total: 0 }) }))).toEqual({
      label: "no cases reported",
      tone: "neutral",
      dot: undefined,
    });
  });

  it("draws what ran the attempt with whichever halves are known", () => {
    expect(attemptOrdinal(3, 1847)).toBe("build 3 of loop #1847");
    expect(machineLine(attempt(3, { rigs: [] }))).toBe("forge-01 · 6m 12s");
    expect(machineLine(attempt(3, { build: null }))).toBe("rig helios-rig-02 · 6m 12s");
    expect(machineLine(attempt(3, { strip: strip({ wallTime: null }) }))).toBe("forge-01 + rig helios-rig-02");
    expect(machineLine(attempt(3, { build: null, rigs: [], strip: strip({ wallTime: null }) }))).toBeNull();
  });
});

describe("the strip", () => {
  it("matches mockup 11's five cards, the delta and split as the payload states them", () => {
    expect(stripView(strip())).toEqual({
      total: { label: "Total tests", value: "63", delta: "across 5 suites", tone: "muted" },
      passed: { label: "Passed", value: "61", valueTone: "ok", delta: "▲ 12 vs build 1", tone: "up" },
      failed: {
        label: "Failed",
        value: "1",
        valueTone: "err",
        delta: "pid_overshoot_under_load · HIL",
        tone: "muted",
      },
      flaky: {
        label: "Flaky",
        value: "1",
        valueTone: "warn",
        delta: "passed on retry 2/3",
        tone: "muted",
        watching: 1,
      },
      wall: { label: "Wall time", value: "6m 12s", delta: "4m sim · 2m 12s physical", tone: "muted" },
    });
  });

  it("computes no delta and no split: changing the payload's figures alone changes the lines", () => {
    // The strip's counts disagree with the delta and the split on purpose: what is drawn is what
    // the payload states, never a difference or a sum worked out here.
    const view = stripView(
      strip({
        passed: 5,
        passedDelta: { value: 40, versusAttemptSeq: 7, versusTestRunId: BUILD_2_ID },
        wallTime: { wallMs: 1_000, simMs: 600_000, physicalMs: 60_000 },
      }),
    );

    expect(view.passed.delta).toBe("▲ 40 vs build 7");
    expect(view.wall).toEqual(expect.objectContaining({ value: "1s", delta: "10m sim · 1m physical" }));
  });

  it("says a fall as bad news, no movement as none, and draws no line without a delta", () => {
    expect(passedDelta(strip({ passedDelta: { value: -3, versusAttemptSeq: 2, versusTestRunId: BUILD_2_ID } }))).toEqual({
      delta: "▼ 3 vs build 2",
      tone: "down",
    });
    expect(passedDelta(strip({ passedDelta: { value: 0, versusAttemptSeq: 2, versusTestRunId: BUILD_2_ID } }))).toEqual({
      delta: "no change vs build 2",
      tone: "muted",
    });
    expect(passedDelta(strip({ passedDelta: null }))).toEqual({ delta: null, tone: "muted" });
  });

  it("names the failed card's headline case, and counts the rest", () => {
    expect(failedCaption(strip({ failedCases: [{ ...OVERSHOOT_CASE, physical: false }] }))).toBe(
      "pid_overshoot_under_load",
    );
    expect(
      failedCaption(strip({ failed: 3, failedCases: [OVERSHOOT_CASE, OVERSHOOT_CASE, OVERSHOOT_CASE] })),
    ).toBe("pid_overshoot_under_load · HIL + 2 more");
    expect(failedCaption(strip({ failed: 0, failedCases: [] }))).toBe("nothing failed");
    expect(stripView(strip({ failed: 0, failedCases: [] })).failed.valueTone).toBeUndefined();
  });

  it("draws the flaky card's retry and counts the quarantine's watching cases", () => {
    const several = strip({
      flaky: 3,
      flakyCases: [FLAKY_CASE, { ...FLAKY_CASE, flakeState: "quarantined" }, { ...FLAKY_CASE, flakeState: null }],
    });

    expect(flakyCaption(several)).toBe("3 passed on retry");
    expect(stripView(several).flaky.watching).toBe(1);
    expect(stripView(strip({ flaky: 0, flakyCases: [] })).flaky).toEqual(
      expect.objectContaining({ delta: "none", watching: null }),
    );
    expect(watchingLabel(2)).toBe("quarantine watching (2)");
  });

  it("draws an em dash for a wall time not reported yet, and says so", () => {
    expect(stripView(strip({ wallTime: null })).wall).toEqual(
      expect.objectContaining({ value: NOT_REPORTED, delta: "not reported yet" }),
    );
  });

  it("says one suite in the singular", () => {
    expect(stripView(strip({ suiteCount: 1 })).total.delta).toBe("across 1 suite");
  });
});

describe("the actions", () => {
  const base = { attempt: attempt(3), gate: gate(), gateError: null, mayContribute: true, pending: null };

  it("are all on, labelled with the gate's N, when a runner is available", () => {
    expect(actionsView(base)).toEqual({
      rerunFailed: { label: "Re-run failed (1)", reason: null },
      rerunFull: { label: RERUN_FULL_LABEL, reason: null },
      sendBack: { label: SEND_BACK_LABEL, reason: null },
      note: null,
    });
  });

  it("are off with a stated reason when no runner is eligible, the pool is off, or there is no build", () => {
    const noRunner = actionsView({ ...base, gate: gate({ readiness: "no_eligible_runner" }) });
    expect(noRunner.rerunFailed.reason).toMatch(/No runner in pool hil can take a build right now/);
    expect(noRunner.rerunFull.reason).toBe(noRunner.rerunFailed.reason);
    expect(noRunner.note).toBe(noRunner.rerunFailed.reason);
    expect(noRunner.sendBack.reason).toBeNull();

    expect(readinessReason(gate({ readiness: "pool_disabled" }), 3)).toBe(
      "Pool hil is disabled, so a build cannot be queued.",
    );
    expect(readinessReason(gate({ readiness: "no_source_build", pool: null }), 3)).toBe(
      "No farm build produced Build 3, so there is nothing to re-run.",
    );
    expect(readinessReason(gate({ readiness: "no_eligible_runner", pool: null }), 3)).toMatch(/^No runner in its pool/);
  });

  it("wait for the gate of *this* attempt — another attempt's answer is not drawn", () => {
    expect(actionsView({ ...base, gate: null }).note).toBe(GATE_CHECKING);
    expect(actionsView({ ...base, gate: gate({ testRunId: BUILD_2_ID }) }).rerunFull.reason).toBe(GATE_CHECKING);
    expect(actionsView({ ...base, gate: gate({ testRunId: BUILD_2_ID }) }).rerunFailed.label).toBe("Re-run failed (1)");
    expect(actionsView({ ...base, gate: null, gateError: "It could not be checked." }).note).toBe(
      "It could not be checked.",
    );
  });

  it("are off for a viewer, and while a re-run is being queued", () => {
    expect(actionsView({ ...base, mayContribute: false }).rerunFailed.reason).toBe(VIEWER_REASON);
    expect(actionsView({ ...base, pending: "full" }).rerunFull.reason).toBe(RERUN_PENDING);
  });

  it("switch Re-run failed and Send failures back off when nothing failed", () => {
    const green = actionsView({
      ...base,
      attempt: attempt(4, { strip: strip({ failed: 0, failedCases: [] }) }),
      gate: gate({ testRunId: attempt(4).id, failedCases: 0 }),
    });

    expect(green.rerunFailed).toEqual({ label: "Re-run failed (0)", reason: "Nothing failed in Build 4." });
    expect(green.rerunFull.reason).toBeNull();
    expect(green.sendBack.reason).toBe("Nothing failed in Build 4.");
    expect(green.note).toBe("Nothing failed in Build 4.");
  });

  it("says what became of a re-run in its honest queue state", () => {
    const rerun = (queueState: Rerun["queueState"]): Rerun =>
      ({ testRunId: BUILD_3_ID, scope: "failed", caseKeys: ["a"], job: { number: 483, pool: "hil" }, queueState }) as Rerun;

    expect(rerunOutcome(rerun("offered"))).toBe("Build job #483 queued with 1 case — offered to a runner.");
    expect(rerunOutcome(rerun("queued_runner_available"))).toMatch(/a runner is available/);
    expect(rerunOutcome(rerun("queued_no_eligible_runner"))).toBe(
      "Build job #483 queued with 1 case — no runner is eligible yet, so it waits in pool hil.",
    );
  });
});
