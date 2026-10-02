import type { DigestKpi } from "./digest.assembly";
import { deltaNote, digestSubject, emptyNote, reasonNote, windowText } from "./digest.copy";
import { DIGEST_CONTEXT, emptyWeekFacts, weekDigest } from "./digest.fixture";

/** A KPI row with what a case sets. */
function kpi(overrides: Partial<DigestKpi>): DigestKpi {
  return { ...weekDigest().kpis[0], ...overrides };
}

describe("the digest's shared words", () => {
  it("prints the window and the subject", () => {
    const digest = weekDigest();

    expect(windowText(digest.window)).toBe("Aug 2 – Aug 8, 2026");
    expect(digestSubject(digest, "Acme Robotics")).toBe(
      "Weekly insights · Acme Robotics · Aug 2 – Aug 8, 2026",
    );
  });

  it("prints a window that crosses a month and a year under its last day's year", () => {
    expect(windowText({ from: "2026-12-28", to: "2027-01-03" })).toBe("Dec 28 – Jan 3, 2027");
  });

  it.each([
    [{ deltaText: "▲ 3pts", delta: 3, good: true }, "▲ 3pts vs prior week, better"],
    [{ deltaText: "▲ 3", delta: 3, good: false }, "▲ 3 vs prior week, worse"],
    [{ deltaText: "▼ 2m", delta: -2, good: null }, "▼ 2m vs prior week"],
    // A move too small to print, and a week with no week before it, are different sentences.
    [{ deltaText: null, delta: 0, good: null }, "unchanged vs prior week"],
    [{ deltaText: null, delta: null, good: null }, "no prior week to compare"],
    [{ deltaText: null, delta: null, value: null, valueText: "—" }, ""],
  ])("says how a KPI moved: %j", (overrides, expected) => {
    expect(deltaNote(kpi(overrides))).toBe(expected);
  });

  it("explains an empty week and why the reader got the mail", () => {
    expect(emptyNote(DIGEST_CONTEXT, weekDigest(emptyWeekFacts()))).toBe(
      "No merges, interventions, builds, test runs or model usage were recorded for " +
        "Acme Robotics between Aug 2 – Aug 8, 2026.",
    );
    expect(reasonNote(DIGEST_CONTEXT)).toBe(
      "You receive this because you subscribed to the weekly Insights digest for Acme Robotics.",
    );
    expect(reasonNote({ ...DIGEST_CONTEXT, unsubscribeUrl: null })).toContain(
      "It was not sent to anyone.",
    );
  });
});
