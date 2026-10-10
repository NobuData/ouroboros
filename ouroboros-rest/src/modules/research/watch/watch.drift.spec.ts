import {
  type ThresholdRule,
  type WindowStats,
  driftDisplay,
  evaluateDrift,
  tidy,
  windowPhrase,
} from "./watch.drift";

/**
 * The watch's one judgement (CM.4, #623): what counts as drift, what is noise, and how the
 * drift is printed.
 */

const window = (median: number, overrides: Partial<WindowStats> = {}): WindowStats => ({
  n: 30,
  median,
  spread: 0.2,
  spread_kind: "iqr",
  unit: "cm",
  from: "2026-09-01T00:00:00Z",
  to: "2026-09-08T00:00:00Z",
  ...overrides,
});

const ACCURACY: ThresholdRule = {
  direction: "higher_is_worse",
  warn_pct: 5,
  err_pct: 10,
  min_spread_multiple: 2,
  min_samples: 10,
};
const TIMING: ThresholdRule = { ...ACCURACY, err_pct: 15, min_samples: 5 };
const RATE: ThresholdRule = { ...ACCURACY, direction: "lower_is_worse", warn_pct: 2, err_pct: 5 };

describe("evaluateDrift", () => {
  it("reads mockup 22's hover drift: +14% in gusts is an error", () => {
    expect(evaluateDrift(window(5), window(5.7), ACCURACY, "accuracy")).toEqual({
      status: "drift",
      severity: "err",
      driftValue: 14,
      driftUnit: "%",
      delta: 0.7,
      deltaPct: 14,
    });
  });

  it("reads mockup 22's boot time: a timing drifts in its own unit", () => {
    const baseline = window(3000, { unit: "ms", spread: 40 });

    expect(evaluateDrift(baseline, window(3230, { unit: "ms" }), TIMING, "timing")).toEqual({
      status: "drift",
      severity: "warn",
      driftValue: 230,
      driftUnit: "ms",
      delta: 230,
      deltaPct: 7.67,
    });
  });

  it("warns between the two thresholds and errs from the upper one", () => {
    const at = (median: number) =>
      evaluateDrift(window(100, { spread: 1 }), window(median), ACCURACY, "accuracy");

    expect(at(104.9).status).toBe("within");
    expect(at(105)).toMatchObject({ status: "drift", severity: "warn", driftValue: 5 });
    expect(at(109.99)).toMatchObject({ severity: "warn" });
    expect(at(110)).toMatchObject({ severity: "err", driftValue: 10 });
  });

  it("opens nothing for a change inside the baseline's own spread, however large in percent", () => {
    const noisy = window(5, { spread: 0.5 });

    expect(evaluateDrift(noisy, window(5.9), ACCURACY, "accuracy")).toEqual({
      status: "within",
      reason: "a move of 0.9 cm is inside 2× the baseline's own spread (1 cm)",
      measured: true,
    });
    // Just clear of it, the same percentage counts.
    expect(evaluateDrift(noisy, window(6), ACCURACY, "accuracy").status).toBe("drift");
  });

  it("opens nothing on too few nightly samples", () => {
    expect(evaluateDrift(window(5), window(9, { n: 9 }), ACCURACY, "accuracy")).toEqual({
      status: "within",
      reason:
        "only 9 samples in the nightly window — 10 are needed before a difference means anything",
      measured: false,
    });
    expect(evaluateDrift(window(5), window(9, { n: 1 }), ACCURACY, "accuracy")).toMatchObject({
      reason: expect.stringContaining("only 1 sample in") as string,
    });
    expect(evaluateDrift(window(5), window(9, { n: 10 }), ACCURACY, "accuracy").status).toBe(
      "drift",
    );
  });

  it("does not call an improvement a regression", () => {
    expect(evaluateDrift(window(5), window(4), ACCURACY, "accuracy")).toEqual({
      status: "within",
      reason: "the metric moved, in the direction that is better",
      measured: true,
    });
  });

  it("treats a falling rate as worse, in points", () => {
    const baseline = window(92, { unit: "%", spread: 0.5 });

    expect(evaluateDrift(baseline, window(88, { unit: "%" }), RATE, "rate")).toEqual({
      status: "drift",
      severity: "warn",
      driftValue: -4,
      driftUnit: "%",
      delta: -4,
      deltaPct: -4.35,
    });
    expect(evaluateDrift(baseline, window(96, { unit: "%" }), RATE, "rate").status).toBe("within");
  });

  it("counts either direction when the rule says either", () => {
    const either: ThresholdRule = { ...ACCURACY, direction: "either" };

    expect(evaluateDrift(window(5), window(4), either, "accuracy")).toMatchObject({
      status: "drift",
      severity: "err",
      driftValue: -20,
    });
  });

  it("with no noise gate, the percentage alone decides", () => {
    const flat = window(100, { spread: 0 });

    expect(evaluateDrift(flat, window(106), ACCURACY, "accuracy")).toMatchObject({
      severity: "warn",
    });
    expect(evaluateDrift(flat, window(100), ACCURACY, "accuracy")).toEqual({
      status: "within",
      reason: "the nightly median equals the baseline's",
      measured: true,
    });
  });

  it("refuses to compare different units, or to take a percentage of zero", () => {
    expect(evaluateDrift(window(5), window(9, { unit: "mm" }), ACCURACY, "accuracy")).toEqual({
      status: "within",
      reason: "the nightly window is in mm and the baseline in cm, so they cannot be compared",
      measured: false,
    });
    expect(evaluateDrift(window(0, { spread: 0 }), window(3), ACCURACY, "accuracy")).toEqual({
      status: "within",
      reason:
        "the baseline's median is 0, so a percentage threshold has nothing to measure against",
      measured: false,
    });
  });

  it("measures the percentage against a negative baseline's size", () => {
    expect(
      evaluateDrift(window(-10, { spread: 0 }), window(-8), ACCURACY, "accuracy"),
    ).toMatchObject({ status: "drift", deltaPct: 20, severity: "err" });
  });
});

describe("printing", () => {
  it("rounds to two decimals and never prints -0", () => {
    expect([tidy(7.666), tidy(14.000001), tidy(-0.001), tidy(0)]).toEqual([7.67, 14, 0, 0]);
  });

  it("prints a drift as the database does", () => {
    expect(driftDisplay(14, "%")).toBe("+14%");
    expect(driftDisplay(230, "ms")).toBe("+230 ms");
    expect(driftDisplay(-4.5, "%")).toBe("-4.5%");
    expect(driftDisplay(0, "cm")).toBe("+0 cm");
  });

  it("puts a window in a few words", () => {
    expect(windowPhrase(window(4.7, { n: 7 }))).toBe("median 4.7 cm (n = 7)");
    expect(windowPhrase(window(92.123, { unit: "%" }))).toBe("median 92.12% (n = 30)");
  });
});
