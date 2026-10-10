import { REPLAY_DISPERSION, REPLAY_FORMULAS, replayFormula } from "./replay.formulas";

/**
 * The registered formulas (#561): each estimator declares its computation in the metrics
 * registry's shape, so the Details popover explains the arithmetic that ran.
 */

describe("the replay formula registry", () => {
  it("registers one formula per kind, under ids of the metrics registry's shape", () => {
    expect(Object.keys(REPLAY_FORMULAS).toSorted()).toEqual(["build", "test"]);
    expect(replayFormula("build").id).toBe("build_duration_replay");
    expect(replayFormula("test").id).toBe("test_duration_replay");

    const ids = Object.values(REPLAY_FORMULAS).map((formula) => formula.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
  });

  it.each(Object.values(REPLAY_FORMULAS))("declares $id completely", (formula) => {
    expect(formula.version).toBeGreaterThanOrEqual(1);
    expect(formula.title.trim()).not.toBe("");
    expect(formula.formulaText.trim()).not.toBe("");
    expect(formula.caveats.trim()).not.toBe("");
    expect(formula.sourcePlanes.length).toBeGreaterThan(0);
    for (const plane of formula.sourcePlanes) expect(plane).toMatch(/^[a-z][a-z_]*$/);
    expect(formula.unit).toBe("duration_ms");
    expect(formula.dispersion).toBe(REPLAY_DISPERSION);
  });

  it.each(Object.values(REPLAY_FORMULAS))("says what $id's median, ± and floor are", (formula) => {
    // The popover must explain the arithmetic, not gesture at it.
    expect(formula.formulaText).toMatch(/median/);
    expect(formula.formulaText).toMatch(/median absolute deviation/);
    expect(formula.formulaText).toMatch(/window/);
    expect(formula.formulaText).toMatch(/insufficient history/);
    expect(formula.caveats).toMatch(/not a measurement/);
  });

  it("names the similarity class's parts in the build formula", () => {
    const text = replayFormula("build").formulaText;

    for (const part of [
      "repository",
      "pool",
      "executor",
      "configuration class",
      "image without its tag",
      "command",
    ]) {
      expect(text).toContain(part);
    }
    expect(text).toMatch(/succeeded/);
    expect(replayFormula("build").sourcePlanes).toEqual(["build_farm"]);
  });

  it("rests the test formula on test history, never on build history", () => {
    const formula = replayFormula("test");

    expect(formula.sourcePlanes).toEqual(["test_results"]);
    expect(formula.formulaText).toMatch(/test runs/);
    expect(formula.formulaText).toMatch(/suite set/);
    expect(formula.caveats).toMatch(/not from build history/);
  });
});
