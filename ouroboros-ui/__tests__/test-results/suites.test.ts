import { describe, expect, it } from "vitest";

import {
  SUITE_NAME_LIMIT,
  caseDuration,
  caseView,
  nextRowIndex,
  resolveSuite,
  retryChip,
  selectionCleared,
  suiteLabel,
  suiteParam,
  suiteTone,
  suitesView,
} from "@/app/test-results/suites";

import {
  HIL_SUITE_ID,
  TELEMETRY_SUITE_ID,
  seededSuites,
  suite,
  testCase,
} from "../helpers/test-results";

/**
 * The suites card's rules (#337), without rendering: a row's hue follows its status rather than
 * its ratio, the selection is a name that is found again or not at all, the retry chip is the
 * strip's arithmetic, and the keyboard walks the rows.
 */

/** Counts for a suite of `total` cases. */
function counts(total: number, passed: number, skipped = 0) {
  return { total, passed, failed: total - passed - skipped, flaky: 0, skipped };
}

describe("suiteTone", () => {
  it("follows status, not ratio — 1/2 on the rig is warn where 18/19 in simulation is err", () => {
    expect(suiteTone({ kind: "physical", counts: counts(2, 1) })).toBe("warn");
    expect(suiteTone({ kind: "sim", counts: counts(19, 18) })).toBe("err");
  });

  it("does not soften with the ratio, in either direction", () => {
    expect(suiteTone({ kind: "sim", counts: counts(1000, 999) })).toBe("err");
    expect(suiteTone({ kind: "physical", counts: counts(10, 0) })).toBe("warn");
  });

  it("is ok when nothing failed — every case passed, or was skipped", () => {
    expect(suiteTone({ kind: "sim", counts: counts(24, 24) })).toBe("ok");
    expect(suiteTone({ kind: "physical", counts: counts(2, 2) })).toBe("ok");
    expect(suiteTone({ kind: "sim", counts: counts(6, 4, 2) })).toBe("ok");
  });

  it("counts a flaky case as not passed", () => {
    expect(suiteTone({ kind: "sim", counts: { total: 19, passed: 18, failed: 0, flaky: 1, skipped: 0 } })).toBe("err");
  });

  it("is neutral for a suite nothing ran in", () => {
    expect(suiteTone({ kind: "sim", counts: counts(0, 0) })).toBe("neutral");
  });
});

describe("suiteLabel", () => {
  it("prefixes a rig suite, once", () => {
    expect(suiteLabel({ kind: "physical", name: "HIL rig" })).toBe("PHYSICAL · HIL rig");
    expect(suiteLabel({ kind: "physical", name: "PHYSICAL · HIL rig" })).toBe("PHYSICAL · HIL rig");
    expect(suiteLabel({ kind: "sim", name: "unit · drivers" })).toBe("unit · drivers");
  });
});

describe("suiteParam", () => {
  it("reads a name, trimmed, and the first of several", () => {
    expect(suiteParam("telemetry integration")).toBe("telemetry integration");
    expect(suiteParam("  OTA update ")).toBe("OTA update");
    expect(suiteParam(["motor control", "OTA update"])).toBe("motor control");
  });

  it("reads anything else as nothing selected", () => {
    for (const value of [undefined, null, "", "   ", [], "x".repeat(SUITE_NAME_LIMIT + 1)]) {
      expect(suiteParam(value)).toBeNull();
    }
    expect(suiteParam("x".repeat(SUITE_NAME_LIMIT))).not.toBeNull();
  });
});

describe("resolveSuite", () => {
  it("finds the suite by name, whatever its id in this attempt", () => {
    const earlier = seededSuites().map((each) => ({ ...each, id: `${each.id.slice(0, -3)}1${each.id.slice(-2)}` }));

    expect(resolveSuite(earlier, { name: "telemetry integration", platform: "qemu_cortex_m3" })?.id).toBe(
      earlier[1]!.id,
    );
    expect(earlier[1]!.id).not.toBe(TELEMETRY_SUITE_ID);
  });

  it("chooses the selected platform among suites of one name, else the first", () => {
    const twins = [
      suite({ id: "a", name: "telemetry integration", platform: "native_sim" }),
      suite({ id: "b", name: "telemetry integration", platform: "qemu_cortex_m3" }),
    ];

    expect(resolveSuite(twins, { name: "telemetry integration", platform: "qemu_cortex_m3" })?.id).toBe("b");
    expect(resolveSuite(twins, { name: "telemetry integration", platform: null })?.id).toBe("a");
    expect(resolveSuite(twins, { name: "telemetry integration", platform: "gone" })?.id).toBe("a");
  });

  it("answers nothing — never another suite — for a name the attempt does not have", () => {
    expect(resolveSuite(seededSuites(), { name: "bootloader", platform: "native_sim" })).toBeNull();
    expect(resolveSuite(seededSuites(), { name: "Telemetry Integration", platform: null })).toBeNull();
    expect(resolveSuite([], { name: "telemetry integration", platform: null })).toBeNull();
    expect(resolveSuite(seededSuites(), null)).toBeNull();
  });

  it("says what was cleared, and where", () => {
    expect(selectionCleared("telemetry integration", 1)).toBe(
      "telemetry integration did not run in Build 1 — selection cleared.",
    );
  });
});

describe("the case drill", () => {
  it("prints retry 2/3 for a case that failed twice and then passed", () => {
    expect(retryChip(["failed", "failed", "passed"])).toEqual({
      text: "retry 2/3",
      title: "Passed on retry 2 of 3 runs",
    });
  });

  it("puts a case that never passed on its last retry", () => {
    expect(retryChip(["failed", "error", "failed"])).toEqual({
      text: "retry 2/3",
      title: "Did not pass in 3 runs",
    });
  });

  it("draws no chip for a case that ran once, or not at all", () => {
    expect(retryChip(["passed"])).toBeNull();
    expect(retryChip(["failed"])).toBeNull();
    expect(retryChip([])).toBeNull();
  });

  it("says a first-time pass that was run again as what it is", () => {
    expect(retryChip(["passed", "passed"])?.title).toBe("Passed first time, of 2 runs");
  });

  it("draws a duration in milliseconds under a second, as a span above, and none when unknown", () => {
    expect(caseDuration(412)).toBe("412ms");
    expect(caseDuration(0)).toBe("0ms");
    expect(caseDuration(3100)).toBe("3s");
    expect(caseDuration(61_000)).toBe("1m 01s");
    expect(caseDuration(null)).toBeNull();
    expect(caseDuration(-5)).toBeNull();
    expect(caseDuration(Number.NaN)).toBeNull();
  });

  it("gives each status its hue", () => {
    const tones = (["passed", "failed", "error", "flaky", "skipped"] as const).map(
      (status) => caseView(testCase({ status })).tone,
    );

    expect(tones).toEqual(["ok", "err", "err", "warn", "neutral"]);
  });
});

describe("suitesView", () => {
  it("draws the seeded five rows as the mockup does", () => {
    const rows = suitesView(seededSuites(), null).rows;

    expect(rows.map((row) => [row.label, row.platform, row.count, row.tone])).toEqual([
      ["unit · drivers", "native_sim", "24/24", "ok"],
      ["telemetry integration", "qemu_cortex_m3", "18/19", "err"],
      ["motor control", "qemu_cortex_m3", "12/12", "ok"],
      ["OTA update", "native_sim", "6/6", "ok"],
      ["PHYSICAL · HIL rig", "rig:helios-rig-02", "1/2", "warn"],
    ]);
    expect(rows[1]!.ratio).toBeCloseTo(18 / 19);
    expect(rows[4]!.ratio).toBe(0.5);
    expect(rows[4]!.countLabel).toBe("1 of 2 passed");
  });

  it("selects nothing by default, and scopes nothing", () => {
    const view = suitesView(seededSuites(), null);

    expect(view.rows.some((row) => row.selected)).toBe(false);
    expect(view.scope).toBeNull();
  });

  it("selects one row and hands its scope to the cards it scopes", () => {
    const view = suitesView(seededSuites(), { name: "PHYSICAL · HIL rig", platform: null });

    expect(view.rows.filter((row) => row.selected).map((row) => row.id)).toEqual([HIL_SUITE_ID]);
    expect(view.scope).toEqual({
      id: HIL_SUITE_ID,
      name: "PHYSICAL · HIL rig",
      platform: "rig:helios-rig-02",
      kind: "physical",
    });
  });

  it("draws an empty meter, in no status hue, for a suite nothing ran in", () => {
    const [row] = suitesView([suite({ counts: counts(0, 0) })], null).rows;

    expect(row).toEqual(expect.objectContaining({ ratio: 0, meterTone: null, count: "0/0", tone: "neutral" }));
  });
});

describe("nextRowIndex", () => {
  it("steps with the arrows and stops at the ends", () => {
    expect(nextRowIndex("ArrowDown", 0, 5)).toBe(1);
    expect(nextRowIndex("ArrowUp", 3, 5)).toBe(2);
    expect(nextRowIndex("ArrowDown", 4, 5)).toBeNull();
    expect(nextRowIndex("ArrowUp", 0, 5)).toBeNull();
  });

  it("jumps with Home and End", () => {
    expect(nextRowIndex("Home", 3, 5)).toBe(0);
    expect(nextRowIndex("End", 1, 5)).toBe(4);
    expect(nextRowIndex("Home", 0, 5)).toBeNull();
  });

  it("leaves every other key — Enter and Space are the button's own — and an empty list alone", () => {
    for (const key of ["Enter", " ", "Tab", "a"]) expect(nextRowIndex(key, 1, 5)).toBeNull();
    expect(nextRowIndex("ArrowDown", 0, 0)).toBeNull();
  });
});
