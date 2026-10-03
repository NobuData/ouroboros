import {
  confidenceBasis,
  confidenceNote,
  corpusWindow,
  FULL_READ,
  manifestBudget,
  samplingRecord,
} from "./corpus.manifest";

describe("the corpus window", () => {
  it("is the ninety whole UTC days before the day the run started", () => {
    // Mockup 18's run started on Aug 8; its corpus is May 10 … Aug 7.
    expect(corpusWindow(new Date("2026-08-08T15:12:00Z"))).toEqual({
      from: "2026-05-10",
      to: "2026-08-07",
      days: 90,
    });
  });

  it("excludes the start day even a second after midnight, because that day is not over", () => {
    expect(corpusWindow(new Date("2026-08-08T00:00:01Z")).to).toBe("2026-08-07");
  });
});

describe("a sampling record", () => {
  it("is a full read when everything inside the window was read", () => {
    expect(samplingRecord(1284, 1284, null)).toBe(FULL_READ);
    expect(samplingRecord(0, 0, null)).toEqual({ sampled: false, rate: 1, cap: null });
  });

  it("names the rate, rounded to two places, and the cap that bound it", () => {
    // The seeded page: 1,230,000 of 4,100,000 lines under max_log_lines is the strip's 0.3.
    expect(samplingRecord(1_229_950, 4_100_000, "max_log_lines")).toEqual({
      sampled: true,
      rate: 0.3,
      cap: "max_log_lines",
    });
  });

  it("never rounds a partial read to none or to all, which V080 would refuse and which would lie", () => {
    expect(samplingRecord(1, 10_000, "max_builds").rate).toBe(0.01);
    expect(samplingRecord(9_999, 10_000, "max_builds").rate).toBe(0.99);
  });

  it("refuses a partial read with no budget to explain it", () => {
    expect(() => samplingRecord(5, 10, null)).toThrow(RangeError);
  });

  it("refuses a read larger than what was there", () => {
    expect(() => samplingRecord(11, 10, "max_builds")).toThrow(RangeError);
    expect(() => samplingRecord(-1, 10, "max_builds")).toThrow(RangeError);
  });
});

describe("the manifest budget", () => {
  it("is the caps under V080's keys", () => {
    expect(
      manifestBudget({ maxBuilds: 2000, maxLogLines: 1_230_000, computeCeilingSeconds: 3600 }),
    ).toEqual({ max_builds: 2000, max_log_lines: 1_230_000, compute_ceiling_seconds: 3600 });
  });
});

describe("the confidence note", () => {
  const window = { from: "2026-05-10", to: "2026-08-07", days: 90 };

  it("is the mockup's high note for builds on every day, many a day", () => {
    expect(confidenceNote({ window, builds: 1284, daysWithBuilds: 90 })).toBe(
      "high — 90d of stable telemetry",
    );
  });

  it("is medium for a thinner but regular corpus", () => {
    expect(confidenceNote({ window, builds: 120, daysWithBuilds: 60 })).toBe(
      "medium — builds on 60 of 90 days",
    );
  });

  it("is low, with the count, for a sparse one", () => {
    expect(confidenceNote({ window, builds: 30, daysWithBuilds: 20 })).toBe(
      "low — 30 builds over 90 days",
    );
  });

  it("is not high for many builds crowded into a few days", () => {
    expect(confidenceNote({ window, builds: 5000, daysWithBuilds: 40 })).toMatch(/^low/);
  });
});

describe("the confidence basis", () => {
  const window = { from: "2026-05-10", to: "2026-08-07", days: 90 };

  it("states the level, the inputs, the ratios and the rule that judged them", () => {
    expect(confidenceBasis({ window, builds: 1284, daysWithBuilds: 90 })).toEqual({
      level: "high",
      window_days: 90,
      builds: 1284,
      days_with_builds: 90,
      coverage: 1,
      per_day: 14.2667,
      rule: { high: { coverage: 0.9, per_day: 5 }, medium: { coverage: 0.6, per_day: 1 } },
    });
  });

  it("reaches the same level as the note, for every band", () => {
    for (const [builds, daysWithBuilds] of [
      [1284, 90],
      [120, 60],
      [30, 20],
      [5000, 40],
    ]) {
      const basis = confidenceBasis({ window, builds, daysWithBuilds });
      expect(confidenceNote({ window, builds, daysWithBuilds })).toMatch(
        new RegExp(`^${basis.level} `),
      );
    }
  });

  it("judges on the exact ratio, so a bar is met exactly at its edge", () => {
    // 81 of 90 days is exactly 0.9; 450 builds is exactly five a day.
    expect(confidenceBasis({ window, builds: 450, daysWithBuilds: 81 }).level).toBe("high");
    expect(confidenceBasis({ window, builds: 449, daysWithBuilds: 81 }).level).toBe("medium");
  });

  it("hands out copies of the rule, so a stored basis cannot alter it", () => {
    const basis = confidenceBasis({ window, builds: 1, daysWithBuilds: 1 });
    basis.rule.high.coverage = 0;
    expect(confidenceBasis({ window, builds: 1, daysWithBuilds: 1 }).rule.high.coverage).toBe(0.9);
  });
});
