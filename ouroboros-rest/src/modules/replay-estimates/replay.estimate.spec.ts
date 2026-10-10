import {
  IncompleteEstimateError,
  assertCompleteEstimate,
  cacheContext,
  composeEstimate,
  durationLabel,
  replayNote,
  replayStageRecord,
  type ReplayEstimate,
  type ReplayInsufficient,
} from "./replay.estimate";

/**
 * What a sample may say (#561): an estimate with its whole basis, or insufficient history with
 * the count found — and never a number below the floor.
 */

const POLICY = { windowDays: 30, sampleFloor: 20 };
const CLASS =
  "pool-a · helios-firmware · container · ghcr.io/acme/zephyr-sdk · west build -b board app";
const MOCKUP = { sampleCount: 214, medianMs: 242_000, spreadMs: 20_000 };

describe("a duration, as the card writes it", () => {
  // The same vectors `constraints.sql` holds `replay_duration_label()` to (V121).
  it.each([
    [0, "0s"],
    [20_000, "20s"],
    [59_600, "1m 00s"],
    [242_000, "4m 02s"],
    [3_599_000, "59m 59s"],
    [3_600_000, "1h 00m 00s"],
    [3_800_000, "1h 03m 20s"],
  ])("writes %d ms as %s", (ms, label) => {
    expect(durationLabel(ms)).toBe(label);
  });
});

describe("a replayed row's note", () => {
  // The same vectors `constraints.sql` holds `replay_estimate_note()` to (V121).
  it("is the mockup's line for the mockup's figures", () => {
    expect(replayNote("build", 214, { estimateMs: 242_000, spreadMs: 20_000 })).toBe(
      "est. 4m 02s (214 similar builds, ±20s)",
    );
  });

  it("says test runs for a test estimate", () => {
    expect(replayNote("test", 6, { estimateMs: 625_000, spreadMs: 15_000 })).toBe(
      "est. 10m 25s (6 similar test runs, ±15s)",
    );
  });

  it("does not pluralise one", () => {
    expect(replayNote("build", 1, { estimateMs: 242_000, spreadMs: 0 })).toBe(
      "est. 4m 02s (1 similar build, ±0s)",
    );
  });

  it("is the honest fallback, with the count found, when there is no estimate", () => {
    expect(replayNote("build", 7, null)).toBe(
      "insufficient history — the first real build will measure this (7 similar builds found)",
    );
    expect(replayNote("test", 0, null)).toBe(
      "insufficient history — the first real test run will measure this (0 similar test runs found)",
    );
  });
});

describe("composing an estimate", () => {
  it("reproduces the mockup's row from the mockup's sample", () => {
    const result = composeEstimate("build", CLASS, MOCKUP, POLICY) as ReplayEstimate;

    expect(result).toMatchObject({
      status: "estimate",
      kind: "build",
      estimateMs: 242_000,
      spreadMs: 20_000,
      sampleCount: 214,
      windowDays: 30,
      similarityClass: CLASS,
      note: "est. 4m 02s (214 similar builds, ±20s)",
      cache: null,
    });
  });

  it("returns median, spread, sample count and window together", () => {
    const result = composeEstimate("build", CLASS, MOCKUP, POLICY) as ReplayEstimate;

    for (const part of [
      result.estimateMs,
      result.spreadMs,
      result.sampleCount,
      result.windowDays,
    ]) {
      expect(Number.isSafeInteger(part)).toBe(true);
    }
  });

  it("carries the registered formula with its real inputs, for the popover", () => {
    const result = composeEstimate("build", CLASS, MOCKUP, POLICY);

    expect(result.formula).toMatchObject({
      id: "build_duration_replay",
      version: 1,
      dispersion: "median_absolute_deviation",
      inputs: { similarityClass: CLASS, windowDays: 30, sampleFloor: 20, sampleCount: 214 },
    });
    expect(result.formula.formulaText).toMatch(/median/);
  });

  it("estimates at exactly the floor", () => {
    const result = composeEstimate("build", CLASS, { ...MOCKUP, sampleCount: 20 }, POLICY);

    expect(result.status).toBe("estimate");
  });

  it.each([19, 11, 7, 1, 0])("refuses to guess from %d samples", (sampleCount) => {
    const result = composeEstimate(
      "build",
      CLASS,
      {
        sampleCount,
        medianMs: sampleCount === 0 ? null : 242_000,
        spreadMs: sampleCount === 0 ? null : 20_000,
      },
      POLICY,
    ) as ReplayInsufficient;

    expect(result.status).toBe("insufficient_history");
    expect(result.sampleCount).toBe(sampleCount);
    expect(result.sampleFloor).toBe(20);
    expect(result.windowDays).toBe(30);
    expect(result.similarityClass).toBe(CLASS);
  });

  it("produces no number below the floor — not in a field, not in the note", () => {
    const result = composeEstimate(
      "build",
      CLASS,
      { sampleCount: 7, medianMs: 242_000, spreadMs: 20_000 },
      POLICY,
    );

    expect(result).not.toHaveProperty("estimateMs");
    expect(result).not.toHaveProperty("spreadMs");
    expect(result).not.toHaveProperty("cache");
    expect(result.note).toBe(
      "insufficient history — the first real build will measure this (7 similar builds found)",
    );
    expect(result.note).not.toMatch(/4m 02s|±/);
    // The popover still explains what was looked for, and how little was found.
    expect(result.formula.inputs).toEqual({
      similarityClass: CLASS,
      windowDays: 30,
      sampleFloor: 20,
      sampleCount: 7,
    });
  });

  it("is insufficient rather than a crash for a sample that reports a count and no statistics", () => {
    const result = composeEstimate(
      "build",
      CLASS,
      { sampleCount: 50, medianMs: null, spreadMs: null },
      POLICY,
    );

    expect(result.status).toBe("insufficient_history");
  });

  it("uses the test formula and the test's words for a test", () => {
    const result = composeEstimate(
      "test",
      "helios-firmware · tests · hil + unit",
      { sampleCount: 40, medianMs: 625_000, spreadMs: 15_000 },
      POLICY,
    );

    expect(result.formula.id).toBe("test_duration_replay");
    expect(result.note).toBe("est. 10m 25s (40 similar test runs, ±15s)");
    expect(result).toMatchObject({ kind: "test", cache: null });
  });

  it("holds the floor and window to the policy it is given, not to constants of its own", () => {
    const strict = composeEstimate("build", CLASS, MOCKUP, { windowDays: 7, sampleFloor: 500 });
    const loose = composeEstimate(
      "build",
      CLASS,
      { ...MOCKUP, sampleCount: 3 },
      { windowDays: 90, sampleFloor: 2 },
    );

    expect(strict).toMatchObject({
      status: "insufficient_history",
      windowDays: 7,
      sampleFloor: 500,
    });
    expect(loose).toMatchObject({ status: "estimate", windowDays: 90 });
  });
});

describe("cache context", () => {
  const SEEDED = {
    measured: 231,
    warmCount: 202,
    warmMedianMs: 221_000,
    coldCount: 29,
    coldMedianMs: 410_000,
  };

  it("reports the warm and cold halves beside the estimate, never inside it", () => {
    const result = composeEstimate("build", CLASS, MOCKUP, POLICY, SEEDED) as ReplayEstimate;

    // The headline is the sample's own median — neither half's.
    expect(result.estimateMs).toBe(242_000);
    expect(result.note).toBe("est. 4m 02s (214 similar builds, ±20s)");
    expect(result.cache).toEqual({
      measured: 231,
      warm: { count: 202, medianMs: 221_000 },
      cold: { count: 29, medianMs: 410_000 },
      note: "warm cache ≈ 3m 41s (202 builds) · cold cache ≈ 6m 50s (29 builds)",
    });
  });

  it("is absent when no sampled build reported cache statistics", () => {
    expect(
      cacheContext({
        measured: 0,
        warmCount: 0,
        warmMedianMs: null,
        coldCount: 0,
        coldMedianMs: null,
      }),
    ).toBeNull();
  });

  it("names only the half that exists", () => {
    expect(
      cacheContext({
        measured: 5,
        warmCount: 5,
        warmMedianMs: 200_000,
        coldCount: 0,
        coldMedianMs: null,
      }),
    ).toEqual({
      measured: 5,
      warm: { count: 5, medianMs: 200_000 },
      cold: null,
      note: "warm cache ≈ 3m 20s (5 builds)",
    });
    expect(
      cacheContext({
        measured: 1,
        warmCount: 0,
        warmMedianMs: null,
        coldCount: 1,
        coldMedianMs: 410_000,
      })?.note,
    ).toBe("cold cache ≈ 6m 50s (1 build)");
  });

  it("is never attached to a test estimate", () => {
    const result = composeEstimate(
      "test",
      "r · tests · unit",
      { sampleCount: 40, medianMs: 1, spreadMs: 0 },
      POLICY,
    );

    expect(result).toMatchObject({ cache: null });
  });
});

describe("the completeness probe", () => {
  const estimate = composeEstimate("build", CLASS, MOCKUP, POLICY);
  const insufficient = composeEstimate(
    "build",
    CLASS,
    { sampleCount: 7, medianMs: null, spreadMs: null },
    POLICY,
  );

  it("passes an estimate carrying median, spread, sample count and window", () => {
    expect(assertCompleteEstimate(estimate)).toBe(estimate);
  });

  it("passes insufficient history carrying its count and no number", () => {
    expect(assertCompleteEstimate(insufficient)).toBe(insufficient);
  });

  it.each(["estimateMs", "spreadMs", "sampleCount", "windowDays"])(
    "rejects an estimate returned without %s",
    (field) => {
      const partial: Record<string, unknown> = { ...estimate };
      delete partial[field];

      expect(() => assertCompleteEstimate(partial)).toThrow(IncompleteEstimateError);
      expect(() => assertCompleteEstimate(partial)).toThrow(new RegExp(field));
    },
  );

  it.each([
    ["a null median", { estimateMs: null }],
    ["a fractional median", { estimateMs: 242_000.5 }],
    ["a negative spread", { spreadMs: -1 }],
    ["NaN for a spread", { spreadMs: Number.NaN }],
    ["a sample of zero", { sampleCount: 0 }],
    ["a window of zero days", { windowDays: 0 }],
    ["a blank similarity class", { similarityClass: "  " }],
    ["a status of its own", { status: "guess" }],
  ])("rejects an estimate with %s", (_what, change) => {
    expect(() => assertCompleteEstimate({ ...estimate, ...change })).toThrow(
      IncompleteEstimateError,
    );
  });

  it.each(["estimateMs", "spreadMs"])("rejects insufficient history that carries %s", (field) => {
    expect(() => assertCompleteEstimate({ ...insufficient, [field]: 242_000 })).toThrow(
      /without enough history/,
    );
  });

  it("rejects insufficient history without its count or floor", () => {
    const { sampleCount: _count, ...countless } = insufficient;
    void _count;

    expect(() => assertCompleteEstimate(countless)).toThrow(/sampleCount/);
    expect(() => assertCompleteEstimate({ ...insufficient, sampleFloor: 0 })).toThrow(
      /sampleFloor/,
    );
  });

  it.each([null, undefined, 42, "est. 4m 02s", {}])("rejects %p", (value) => {
    expect(() => assertCompleteEstimate(value)).toThrow(IncompleteEstimateError);
  });

  it("names everything that is wrong at once", () => {
    try {
      assertCompleteEstimate({ status: "estimate" });
      throw new Error("the probe passed an empty estimate");
    } catch (error) {
      expect(error).toBeInstanceOf(IncompleteEstimateError);
      expect((error as IncompleteEstimateError).missing).toEqual([
        "similarityClass",
        "windowDays",
        "estimateMs",
        "spreadMs",
        "sampleCount",
      ]);
    }
  });
});

describe("the stage row a result is recorded as", () => {
  it("stores an estimate with its sample, spread, class and window", () => {
    expect(replayStageRecord(composeEstimate("build", CLASS, MOCKUP, POLICY))).toEqual({
      how: "replayed",
      note: "est. 4m 02s (214 similar builds, ±20s)",
      metrics: {
        estimate_ms: 242_000,
        spread_ms: 20_000,
        sample_count: 214,
        similarity_class: CLASS,
        window_days: 30,
      },
    });
  });

  it("stores insufficient history with the count found and no number", () => {
    const record = replayStageRecord(
      composeEstimate(
        "build",
        CLASS,
        { sampleCount: 7, medianMs: 242_000, spreadMs: 20_000 },
        POLICY,
      ),
    );

    expect(record).toEqual({
      how: "replayed",
      note: "insufficient history — the first real build will measure this (7 similar builds found)",
      metrics: {
        insufficient_history: true,
        sample_count: 7,
        similarity_class: CLASS,
        window_days: 30,
      },
    });
  });

  it("stores only keys dry_run_stage_metrics_valid() knows", () => {
    // V121's validator refuses any other key on a row, so cache context and the formula stay
    // in the response and off the record.
    const known = new Set([
      "estimate_ms",
      "spread_ms",
      "sample_count",
      "similarity_class",
      "window_days",
      "insufficient_history",
    ]);
    const cache = { measured: 9, warmCount: 9, warmMedianMs: 1, coldCount: 0, coldMedianMs: null };

    for (const sample of [MOCKUP, { sampleCount: 0, medianMs: null, spreadMs: null }]) {
      const record = replayStageRecord(composeEstimate("build", CLASS, sample, POLICY, cache));

      for (const key of Object.keys(record.metrics)) expect(known).toContain(key);
    }
  });
});
