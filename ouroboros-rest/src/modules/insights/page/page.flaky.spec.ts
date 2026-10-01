import { DAYS, flakyCase } from "./page.fixture";
import { flakyOf } from "./page.flaky";

describe("the flaky card", () => {
  it("computes a case's rate and history from its real occurrences", () => {
    const [row] = flakyOf([flakyCase()], DAYS).cases;

    expect(row).toMatchObject({
      name: "tests/hil/test_estop_release.py",
      suite: "physical · HIL",
      repository: "helios-firmware",
      state: "quarantined",
      // 4 flaky of 100 observed.
      ratePct: 4,
      // 2% in the first half of the window, 6% in the second.
      trend: "rising",
      platform: "rig:hil-rig-02",
    });
    expect(row.history).toHaveLength(30);
    expect(row.history[2]).toEqual({ day: "2026-07-12", ratePct: 2 });
    expect(row.history[25]).toEqual({ day: "2026-08-04", ratePct: 6 });
    // A day the case did not run is unknown, not zero.
    expect(row.history[0]).toEqual({ day: DAYS[0], ratePct: null });
    expect(row).not.toHaveProperty("resolvedBy");
  });

  it("reads a falling and a flat trend from the same arithmetic", () => {
    const falling = flakyCase({
      history: [
        { day: "2026-07-12", observed: 10, flaky: 5 },
        { day: "2026-08-04", observed: 10, flaky: 0 },
      ],
    });
    const flat = flakyCase({
      history: [
        { day: "2026-07-12", observed: 10, flaky: 1 },
        { day: "2026-08-04", observed: 20, flaky: 2 },
      ],
    });
    const oneHalf = flakyCase({ history: [{ day: "2026-08-04", observed: 10, flaky: 9 }] });

    expect(flakyOf([falling, flat, oneHalf], DAYS).cases.map((row) => row.trend)).toEqual([
      "falling",
      "flat",
      // Nothing ran in the first half, so there is nothing to compare with.
      "flat",
    ]);
  });

  it("names the loop on a fixed case, and no rig when none is known", () => {
    const resolvedBy = { runId: "5eed005f-0000-4000-8000-000000001847", issueNumber: 1847 };
    const [row] = flakyOf(
      [flakyCase({ state: "fixed", platform: null, resolvedBy, flaky: 0, observed: 40 })],
      DAYS,
    ).cases;

    expect(row).toMatchObject({ state: "fixed", ratePct: 0, resolvedBy });
    expect(row).not.toHaveProperty("platform");
  });

  it("answers a null rate for a case with no occurrence in the window, and an empty card", () => {
    const [row] = flakyOf([flakyCase({ observed: 0, flaky: 0, history: [] })], DAYS).cases;

    expect(row).toMatchObject({ ratePct: null, trend: "flat" });
    expect(flakyOf([], DAYS)).toEqual({ cases: [] });
  });
});
