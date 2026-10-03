import {
  changePointMetric,
  contributionOf,
  factorOf,
  measuredWindow,
  noteOf,
  roundTo,
  targetOf,
  unitScale,
  verdictOf,
} from "./measurement.math";

/**
 * The measurement job's arithmetic (BV.6, #515), against mockup 18's own numbers — the pair the
 * Predicted vs Measured card prints — and the bound V089 puts on a single outlier.
 */

describe("the verdict", () => {
  it.each([
    // predicted −220 · measured −235 ⇒ ratio 1.07 ⇒ delivered (the test-suite split)
    [-220, -235, false, "delivered"],
    // predicted −110 · measured −72 ⇒ ratio 0.65 ⇒ under (the ccache warm-up)
    [-110, -72, false, "under"],
    [-110, -150, false, "over"],
    // a delta the wrong way round is a negative ratio, which is under
    [-110, 30, false, "under"],
    // the bands are inclusive
    [-100, -80, false, "delivered"],
    [-100, -120, false, "delivered"],
  ] as const)("predicted %d, measured %d ⇒ %s", (predicted, measured, confounded, verdict) => {
    expect(verdictOf(predicted, measured, 0.8, 1.2, confounded)).toBe(verdict);
  });

  it("is confounded whenever anything interfered — never a clean verdict, however good the ratio", () => {
    expect(verdictOf(-220, -235, 0.8, 1.2, true)).toBe("confounded");
  });
});

describe("the bounded calibration factor", () => {
  it("reproduces the mockup's cache correction: −72 against −110 is 0.6545", () => {
    expect(factorOf([{ measuredDelta: -72, raw: -110 }])).toBe(0.6545);
  });

  it("is the weighted mean of the ratios, each held to [0, 2]", () => {
    expect(contributionOf(-1100, -110)).toBe(-220);
    expect(contributionOf(40, -110)).toBe(0);
    // One outlier ten times its prediction counts double, not tenfold.
    expect(
      factorOf([
        { measuredDelta: -100, raw: -100 },
        { measuredDelta: -1000, raw: -100 },
      ]),
    ).toBe(1.5);
  });

  it("has nothing to divide by without a raw prediction", () => {
    expect(factorOf([])).toBeUndefined();
  });

  it("rounds half away from zero, as PostgreSQL's numeric round does", () => {
    expect(roundTo(0.65455, 4)).toBe(0.6546);
    expect(roundTo(-0.65455, 4)).toBe(-0.6546);
  });
});

describe("the composed note", () => {
  it("reads as the mockup prints it when an under-delivery moved the model", () => {
    expect(noteOf("under", "cache_window", 1, 0.6545, [])).toBe(
      "under-delivered — analyzer revised its cache model",
    );
  });

  it("says so when the factor did not move, and says nothing for a delivered row", () => {
    expect(noteOf("over", "queue_correlation", 1.2, 1.2, [])).toBe(
      "over-delivered — analyzer kept its queue model at 1.20",
    );
    expect(noteOf("delivered", "workflow_outcome", 1, 1.0682, [])).toBeNull();
  });

  it("names the interference on a confounded row", () => {
    const confound = { kind: "application" as const, id: "s-2", date: "2026-07-09" };

    expect(noteOf("confounded", "cache_window", 1, 1, [confound])).toBe(
      "confounded — 1 interfering event in the window; not counted toward calibration",
    );
  });
});

describe("the measured window and how it is read", () => {
  it("is day 1 to day N — the apply day belongs to neither side", () => {
    expect(measuredWindow("2026-07-09", "2026-07-23")).toEqual({
      from: "2026-07-10",
      to: "2026-07-23",
    });
  });

  it("reads milliseconds as seconds for a prediction in seconds", () => {
    expect(unitScale("duration_ms", "seconds")).toBe(0.001);
    expect(unitScale("count", "interventions")).toBe(1);
  });

  it("uses the baseline's statistic, else the metric's aggregation, and has none for a ratio", () => {
    expect(targetOf("queue_wait", "p95", "median", 0.001)).toEqual({
      metric: "queue_wait",
      statistic: "p95",
      scale: 0.001,
    });
    expect(targetOf("cycle_time", undefined, "median", 0.001)?.statistic).toBe("median");
    expect(targetOf("human_interventions", undefined, "sum", 1)?.statistic).toBe("weekly_sum");
    expect(targetOf("merge_rate", undefined, "ratio", 1)).toBeUndefined();
  });

  it("maps the change-point analyzer's series onto the metric it is a series of", () => {
    expect(changePointMetric("build.duration_median")).toBe("build_duration");
    expect(changePointMetric("queue_wait")).toBe("queue_wait");
  });
});
