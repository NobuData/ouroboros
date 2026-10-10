import { deltaOf, quantile, round, signed, summarize } from "./telemetry.stats";

/** The arithmetic a telemetry citation rests on (#619) — small enough to redo by hand. */

describe("a sample's summary", () => {
  it("is null for an empty sample — nothing measured is not zero", () => {
    expect(summarize([])).toBeNull();
  });

  it("gives the median, interquartile range and extremes of the seeded overshoot measurements", () => {
    // Mockup 11: three builds at 2.4 %, the fix at 1.7 %.
    expect(summarize([2.4, 2.4, 2.4, 1.7])).toEqual({
      n: 4,
      median: 2.4,
      spread: 0.175,
      min: 1.7,
      max: 2.4,
    });
  });

  it("does not depend on the order the values arrive in", () => {
    expect(summarize([9, 1, 5, 3, 7])).toEqual(summarize([1, 3, 5, 7, 9]));
    expect(summarize([9, 1, 5, 3, 7])).toEqual({ n: 5, median: 5, spread: 4, min: 1, max: 9 });
  });

  it("interpolates the way percentile_cont does, so SQL and this agree", () => {
    const sorted = [200, 202, 204, 206];

    expect(quantile(sorted, 0.5)).toBe(203);
    expect(quantile(sorted, 0.25)).toBe(201.5);
    expect(quantile(sorted, 0)).toBe(200);
    expect(quantile(sorted, 1)).toBe(206);
    expect(quantile([7], 0.75)).toBe(7);
  });

  it("gives one value a spread of zero, not an absent one", () => {
    expect(summarize([31])).toEqual({ n: 1, median: 31, spread: 0, min: 31, max: 31 });
  });
});

describe("a signed delta", () => {
  it("is b − a, and the same as a percentage of a", () => {
    // The regression watch's row: a 31 cm baseline, 35.34 cm now.
    expect(deltaOf(31, 35.34)).toEqual({ delta: 4.34, deltaPct: 14 });
  });

  it("is negative when the later window is lower", () => {
    expect(deltaOf(2.4, 1.7)).toEqual({ delta: -0.7, deltaPct: -29.1667 });
  });

  it("has no percentage from zero — and does not invent one", () => {
    expect(deltaOf(0, 5)).toEqual({ delta: 5, deltaPct: null });
  });

  it("measures the percentage against the size of a negative baseline", () => {
    expect(deltaOf(-10, -5)).toEqual({ delta: 5, deltaPct: 50 });
  });

  it("is zero for two equal readings", () => {
    expect(deltaOf(4120, 4120)).toEqual({ delta: 0, deltaPct: 0 });
  });
});

describe("printing a figure", () => {
  it.each([
    [14, "%", "+14%"],
    [-0.3, "%", "−0.3%"],
    [230, "ms", "+230 ms"],
    [2.9478, "pts", "+2.9478 pts"],
    [0, "ms", "0 ms"],
  ])("writes %d %s as %s", (value, unit, text) => {
    expect(signed(value, unit)).toBe(text);
  });

  it("rounds a derived figure to four places", () => {
    expect(round(2.94784999)).toBe(2.9478);
    expect(round(0.1 + 0.2)).toBe(0.3);
  });
});
