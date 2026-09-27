import { figureWithUnit, metricLabel, sharedScale } from "./hil.format";

/**
 * The HIL figures both PR cards print (#358's gate line, #359's evidence line) — one reading of a
 * measurement on one page.
 */
describe("the shared HIL formatting", () => {
  it("drops a percent suffix from a metric and spaces its words", () => {
    expect(metricLabel("overshoot_pct")).toBe("overshoot");
    expect(metricLabel("retained_frames_percent")).toBe("retained frames");
    expect(metricLabel("reordered_frames")).toBe("reordered frames");
  });

  it("prints a value and its limit at the finer of their scales, never rounding", () => {
    const scale = sharedScale("1.7", "2");

    expect(scale).toBe(1);
    expect([figureWithUnit("1.7", "%", scale), figureWithUnit("2", "%", scale)]).toEqual([
      "1.7%",
      "2.0%",
    ]);
    expect(figureWithUnit("2.45", "%", 1)).toBe("2.45%");
    expect(sharedScale()).toBe(0);
  });

  it("glues a percent, drops a count's unit and spaces any other", () => {
    expect(figureWithUnit("3", "count", 0)).toBe("3");
    expect(figureWithUnit("412", "ms", 0)).toBe("412 ms");
  });
});
