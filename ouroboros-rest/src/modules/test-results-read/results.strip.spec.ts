import { activationState, passedDelta, retentionDays, type DeltaAttempt } from "./results.strip";

/** An attempt with a total and a passed count. */
function attempt(seq: number, passed: number, total = 63): DeltaAttempt {
  return {
    id: `build-${String(seq)}`,
    attemptSeq: seq,
    counts: { total, passed, failed: total - passed, flaky: 0, skipped: 0 },
  };
}

/** Mockup 11's `#482`: 49 → 61 → 61 (the re-run of the failed set) → 63. */
const MOCKUP = [attempt(1, 49), attempt(2, 61), attempt(3, 61), attempt(4, 63)];

describe("passedDelta — the change since the count last moved (#333)", () => {
  it("is ▲ 12 against Build 1 on Build 3, which carried Build 2's 61 forward", () => {
    expect(passedDelta(MOCKUP, "build-3")).toEqual({
      value: 12,
      versusAttemptSeq: 1,
      versusTestRunId: "build-1",
    });
  });

  it("is ▲ 12 against Build 1 on Build 2", () => {
    expect(passedDelta(MOCKUP, "build-2")).toMatchObject({ value: 12, versusAttemptSeq: 1 });
  });

  it("is ▲ 2 against Build 3 on Build 4", () => {
    expect(passedDelta(MOCKUP, "build-4")).toMatchObject({ value: 2, versusAttemptSeq: 3 });
  });

  it("is null on the first attempt — there is nothing to compare with", () => {
    expect(passedDelta(MOCKUP, "build-1")).toBeNull();
  });

  it("is negative when the count fell", () => {
    expect(passedDelta([attempt(1, 61), attempt(2, 50)], "build-2")).toMatchObject({
      value: -11,
      versusAttemptSeq: 1,
    });
  });

  it("is null when every earlier attempt passed the same number", () => {
    expect(passedDelta([attempt(1, 61), attempt(2, 61)], "build-2")).toBeNull();
  });

  it("never measures against an attempt that has reported no case", () => {
    expect(
      passedDelta([attempt(1, 49), attempt(2, 0, 0), attempt(3, 61)], "build-3"),
    ).toMatchObject({ value: 12, versusAttemptSeq: 1 });
  });

  it("is null for an attempt that has reported no case yet", () => {
    expect(passedDelta([attempt(1, 49), attempt(2, 0, 0)], "build-2")).toBeNull();
  });

  it("reads the attempts in sequence whatever order they arrive in", () => {
    expect(passedDelta([...MOCKUP].reverse(), "build-3")).toMatchObject({ versusAttemptSeq: 1 });
  });

  it("is null for an attempt that is not in the list", () => {
    expect(passedDelta(MOCKUP, "build-9")).toBeNull();
  });
});

describe("activationState — decision T8 (#333)", () => {
  it("is gate_armed when the run's PR carries a required test_suite gate", () => {
    expect(activationState(true, true)).toBe("gate_armed");
    expect(activationState(false, true)).toBe("gate_armed");
  });

  it("is intent_stored when block-until-green is on and nothing holds the PR yet", () => {
    expect(activationState(true, null)).toBe("intent_stored");
    expect(activationState(true, false)).toBe("intent_stored");
  });

  it("is none when there is neither an intent nor a gate", () => {
    expect(activationState(false, null)).toBe("none");
    expect(activationState(false, false)).toBe("none");
  });
});

describe("retentionDays", () => {
  it("is the card's `retained 30d` for a thirty-day window", () => {
    const created = new Date("2026-09-20T14:00:00Z");
    expect(retentionDays(created, new Date("2026-10-20T14:00:00Z"))).toBe(30);
  });

  it("rounds to the nearest whole day", () => {
    const created = new Date("2026-09-20T14:00:00Z");
    expect(retentionDays(created, new Date("2026-09-27T20:00:00Z"))).toBe(7);
  });
});
