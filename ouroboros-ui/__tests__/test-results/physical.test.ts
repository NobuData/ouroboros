import { describe, expect, it } from "vitest";

import {
  CASE_NAME_LIMIT,
  NO_PHYSICAL,
  breaches,
  caseCleared,
  caseOutOfScope,
  caseParam,
  decimalsOf,
  figure,
  measuredLine,
  metricLabel,
  physicalSuites,
  physicalView,
  resolveCase,
  rigOnline,
  simulatedScope,
  verdictPill,
} from "@/app/test-results/physical";
import { suitesView } from "@/app/test-results/suites";

import { farmRunner } from "../helpers/farm";
import {
  HIL_SUITE_ID,
  OVERSHOOT_CASE,
  TELEMETRY_SUITE_ID,
  measurement,
  mockupPage,
  mockupRigSuite,
  page,
  physicalCase,
  suite,
  testCase,
} from "../helpers/test-results";

/**
 * The physical-tests card's rules (#338): the measured line composed from stored fields, a breach
 * read as a comparison, the presence pill only for a rig that is a connected runner, the degraded
 * suite, and the selection by name.
 */

/** Every measured line of the card, as text. */
function lines(view: ReturnType<typeof physicalView>): string[] {
  return view.groups.flatMap((group) => group.rows.flatMap((row) => row.measured.map((line) => line.text)));
}

describe("the measured line", () => {
  it("composes the mockup's four rows from value, unit, limit and direction", () => {
    expect(lines(physicalView(mockupPage(), null, null, null))).toEqual([
      "slot b fallback 412ms vs limit 500ms",
      "reordered frames 0 vs limit 0 (was 37 in build 1)",
      "overshoot 2.4% vs limit 2.0%",
      "recovery beacon 1.8s vs limit 3.0s",
    ]);
  });

  it("prints the value and its limit to the more precise one's decimals", () => {
    expect(measuredLine(measurement({ value: 2.4, limit: 2 })).limit).toBe("vs limit 2.0%");
    expect(measuredLine(measurement({ value: 2, limit: 2.25 })).value).toBe("2.00%");
    expect(measuredLine(measurement({ value: 412, limit: 500, unit: "ms" })).text).toMatch(/412ms vs limit 500ms$/);
  });

  it("counts decimals, and gives a number that is not finite none", () => {
    expect(decimalsOf(2)).toBe(0);
    expect(decimalsOf(2.4)).toBe(1);
    expect(decimalsOf(0.125)).toBe(3);
    expect(decimalsOf(1 / 3)).toBe(6);
    expect(decimalsOf(Number.NaN)).toBe(0);
    expect(decimalsOf(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("appends the unit with no space, and prints a count bare", () => {
    expect(figure(2, "%", 1)).toBe("2.0%");
    expect(figure(37, "count", 0)).toBe("37");
    expect(figure(Number.NaN, "ms", 2)).toBe("NaNms");
  });

  it("names a metric by its identifier, without the word that repeats the unit", () => {
    expect(metricLabel("overshoot_pct", "%")).toBe("overshoot");
    expect(metricLabel("slot_b_fallback_ms", "ms")).toBe("slot b fallback");
    expect(metricLabel("reordered_frames", "count")).toBe("reordered frames");
    // A suffix that is not this measurement's unit is part of the name.
    expect(metricLabel("settle_ms", "s")).toBe("settle ms");
    // A metric that is only its unit keeps its one word.
    expect(metricLabel("ms", "ms")).toBe("ms");
  });

  it("renders a comparative only when one is stored — absent, not zeroed", () => {
    expect(measuredLine(measurement({ comparative: null })).comparative).toBeNull();
    expect(measuredLine(measurement({ comparative: "  " })).comparative).toBeNull();
    expect(measuredLine(measurement({ comparative: null })).text).toBe("overshoot 2.4% vs limit 2.0%");
    expect(measuredLine(measurement({ comparative: "was 2.9% in build 1" })).comparative).toBe(
      "(was 2.9% in build 1)",
    );
  });
});

describe("a breach", () => {
  it("is the value past a max limit, which is inclusive", () => {
    expect(breaches(measurement({ value: 2.4, limit: 2, limitKind: "max" }))).toBe(true);
    expect(breaches(measurement({ value: 2, limit: 2, limitKind: "max" }))).toBe(false);
    expect(breaches(measurement({ value: 1.7, limit: 2, limitKind: "max" }))).toBe(false);
  });

  it("is the value short of a min limit, with no special case", () => {
    const low = measurement({ metric: "hold_torque_nm", value: 1.8, unit: "Nm", limit: 2, limitKind: "min" });
    const high = { ...low, value: 2.4 };

    expect(breaches(low)).toBe(true);
    expect(breaches(high)).toBe(false);
    expect(breaches({ ...low, value: 2 })).toBe(false);
    expect(measuredLine(low).text).toBe("hold torque 1.8Nm vs limit 2.0Nm");
    expect(measuredLine(low).breached).toBe(true);
    expect(measuredLine(high).breached).toBe(false);
  });

  it("is the comparison, whatever verdict was stored beside it", () => {
    expect(breaches(measurement({ value: 1, limit: 2, limitKind: "max", verdict: "fail" }))).toBe(false);
  });

  it("falls back to the stored verdict for a direction this client does not know", () => {
    const sideways = { ...measurement(), limitKind: "within" as unknown as "max" };

    expect(breaches({ ...sideways, verdict: "fail" })).toBe(true);
    expect(breaches({ ...sideways, verdict: "pass" })).toBe(false);
  });
});

describe("the pill", () => {
  it("is pass or FAIL, as the mockup writes them", () => {
    expect(verdictPill("passed")).toEqual({ text: "pass", tone: "ok" });
    expect(verdictPill("failed")).toEqual({ text: "FAIL", tone: "err" });
    expect(verdictPill("error")).toEqual({ text: "ERROR", tone: "err" });
    expect(verdictPill("flaky")).toEqual({ text: "flaky", tone: "warn" });
    expect(verdictPill("skipped")).toEqual({ text: "skipped", tone: "neutral" });
  });

  it("prints a status it does not know as it came", () => {
    expect(verdictPill("paused" as unknown as "passed")).toEqual({ text: "paused", tone: "neutral" });
  });
});

describe("the rig's presence", () => {
  it("is a connected runner of the rig's name", () => {
    for (const status of ["online", "building", "draining"] as const) {
      expect(rigOnline("helios-rig-02", [farmRunner({ name: "helios-rig-02", status })])).toBe(true);
    }
  });

  it("is not an offline or a removed one", () => {
    for (const status of ["offline", "removed"] as const) {
      expect(rigOnline("helios-rig-02", [farmRunner({ name: "helios-rig-02", status })])).toBe(false);
    }
  });

  it("is not another machine, however alike its name", () => {
    expect(rigOnline("helios-rig-02", [farmRunner({ name: "forge-01", status: "online" })])).toBe(false);
    expect(rigOnline("helios-rig-02", [farmRunner({ name: "HELIOS-RIG-02", status: "online" })])).toBe(false);
    expect(rigOnline("helios-rig-02", [farmRunner({ name: "helios-rig-020", status: "online" })])).toBe(false);
  });

  it("is not claimed when the farm has not been read, or is empty", () => {
    expect(rigOnline("helios-rig-02", null)).toBe(false);
    expect(rigOnline("helios-rig-02", [])).toBe(false);
  });
});

describe("the card", () => {
  it("heads each rig with its name, its bench and whether it is online", () => {
    const runners = [farmRunner({ name: "helios-rig-02", status: "online" })];
    const [group] = physicalView(mockupPage(), null, null, runners).groups;

    expect(group).toMatchObject({
      id: HIL_SUITE_ID,
      rig: "helios-rig-02",
      heading: "Rig helios-rig-02",
      online: true,
      bench: "bench: CAN bus + motor + power-cycler",
      degraded: false,
    });
    expect(physicalView(mockupPage(), null, null, null).groups[0]?.online).toBe(false);
  });

  it("names a rig by its platform when the suite states no rig, and prints no bench it was not told", () => {
    const bare = mockupRigSuite({ rig: null, bench: null });
    const [group] = physicalView(page({ suites: [bare] }), null, null, null).groups;

    expect(group?.rig).toBe("rig:helios-rig-02");
    expect(group?.bench).toBeNull();
    expect(physicalView(page({ suites: [mockupRigSuite({ bench: " " })] }), null, null, null).groups[0]?.bench).toBeNull();
  });

  it("draws the rows in the suite's order, with the mockup's names, pills and procedures", () => {
    const [group] = physicalView(mockupPage(), null, null, null).groups;

    expect(group?.rows.map((row) => [row.name, row.pill.text, row.failing])).toEqual([
      ["Power-loss mid-flash recovery", "pass", false],
      ["CAN bus frame order under 90% load", "pass", false],
      ["Motor overshoot on e-stop release", "FAIL", true],
      ["BLE beacon in dual-slot-corrupt state", "pass", false],
    ]);
    expect(group?.rows[2]?.procedure).toBe("dyno bench releases e-stop under 2 Nm load, 3 trials");
    expect(group?.rows[2]?.measured[0]?.breached).toBe(true);
    expect(group?.rows[0]?.measured[0]?.breached).toBe(false);
  });

  it("degrades a suite with no measurements to plain rows, and invents no limit", () => {
    const junitOnly = page({ suites: [mockupRigSuite({ resultsFormat: "junit" })], physical: [] });
    const [group] = physicalView(junitOnly, null, null, null).groups;

    expect(group?.degraded).toBe(true);
    expect(group?.rows).toHaveLength(4);
    for (const row of group?.rows ?? []) {
      expect(row.measured).toEqual([]);
      expect(row.procedure).toBeNull();
    }
    expect(group?.rows[2]?.pill.text).toBe("FAIL");
  });

  it("draws a case with no measurement plain among measured ones, without calling the suite degraded", () => {
    const partial = mockupPage({
      physical: [physicalCase(), physicalCase({ caseId: "5eed0035-0000-4000-8000-000000000502", measurements: [] })],
    });
    const [group] = physicalView(partial, null, null, null).groups;

    expect(group?.degraded).toBe(false);
    expect(group?.rows.map((row) => row.measured.length)).toEqual([0, 0, 1, 0]);
    expect(group?.rows[0]?.procedure).toBeNull();
  });

  it("draws two physical suites as two rig groups", () => {
    const second = mockupRigSuite({
      id: "5eed0032-0000-4000-8000-000000048306",
      name: "PHYSICAL · thermal rig",
      platform: "rig:helios-rig-03",
      rig: "helios-rig-03",
      bench: "thermal chamber",
      cases: [testCase({ id: "5eed0035-0000-4000-8000-000000000601", name: "soak_at_85c" })],
    });
    const runners = [farmRunner({ name: "helios-rig-03", status: "building" })];
    const view = physicalView(mockupPage({ suites: [mockupRigSuite(), second] }), null, null, runners);

    expect(view.groups.map((group) => [group.rig, group.online, group.degraded])).toEqual([
      ["helios-rig-02", false, false],
      ["helios-rig-03", true, true],
    ]);
  });

  it("says so when the build ran nothing on a rig", () => {
    const view = physicalView(page({ suites: [suite()] }), null, null, null);

    expect(view.groups).toEqual([]);
    expect(view.note).toBe(NO_PHYSICAL);
  });
});

describe("the suites card's selection", () => {
  const both = mockupPage();

  it("filters the card to a selected physical suite", () => {
    const second = mockupRigSuite({ id: "5eed0032-0000-4000-8000-000000048306", name: "thermal", platform: "rig:b", rig: "b" });
    const suites = [...both.suites, second];
    const scope = suitesView(suites, { name: "thermal", platform: null }).scope;

    expect(physicalSuites(suites, scope).map((each) => each.name)).toEqual(["thermal"]);
    expect(physicalView({ ...both, suites }, scope, null, null).groups.map((group) => group.rig)).toEqual(["b"]);
  });

  it("leaves no group for a simulated suite, and says why", () => {
    const scope = suitesView(both.suites, { name: "telemetry integration", platform: null }).scope;
    const view = physicalView(both, scope, null, null);

    expect(scope?.id).toBe(TELEMETRY_SUITE_ID);
    expect(view.groups).toEqual([]);
    expect(view.note).toBe(simulatedScope("telemetry integration"));
  });

  it("draws every rig when no suite is selected", () => {
    expect(physicalView(both, null, null, null).groups).toHaveLength(1);
  });
});

describe("the selected case", () => {
  const name = "Motor overshoot on e-stop release";

  it("is read from ?case=, trimmed, and is nothing when blank or over-long", () => {
    expect(caseParam(` ${name} `)).toBe(name);
    expect(caseParam([name, "other"])).toBe(name);
    expect(caseParam("  ")).toBeNull();
    expect(caseParam(undefined)).toBeNull();
    expect(caseParam(null)).toBeNull();
    expect(caseParam("x".repeat(CASE_NAME_LIMIT))).not.toBeNull();
    expect(caseParam("x".repeat(CASE_NAME_LIMIT + 1))).toBeNull();
  });

  it("marks its row, and scopes the failure detail to it", () => {
    const view = physicalView(mockupPage(), null, { name, platform: null }, null);

    expect(view.groups[0]?.rows.map((row) => row.selected)).toEqual([false, false, true, false]);
    expect(view.scope).toEqual({
      caseId: OVERSHOOT_CASE.caseId,
      name,
      suiteId: HIL_SUITE_ID,
      status: "failed",
      hasFailure: true,
    });
  });

  it("scopes nothing when nothing is selected", () => {
    const view = physicalView(mockupPage(), null, null, null);

    expect(view.scope).toBeNull();
    expect(view.groups[0]?.rows.some((row) => row.selected)).toBe(false);
  });

  it("is never another case: a name no rig ran resolves to nothing", () => {
    const suites = physicalSuites(mockupPage().suites, null);

    expect(resolveCase(suites, { name: "motor overshoot", platform: null })).toBeNull();
    expect(resolveCase(suites, null)).toBeNull();
    expect(physicalView(mockupPage(), null, { name: "can_frame_roundtrip", platform: null }, null).scope).toBeNull();
  });

  it("is found on the rig it was selected on when two rigs ran a case of one name", () => {
    const other = mockupRigSuite({
      id: "5eed0032-0000-4000-8000-000000048306",
      platform: "rig:helios-rig-03",
      rig: "helios-rig-03",
      cases: [testCase({ id: "5eed0035-0000-4000-8000-000000000601", name })],
    });
    const suites = [mockupRigSuite(), other];

    expect(resolveCase(suites, { name, platform: "rig:helios-rig-03" })?.found.id).toBe(
      "5eed0035-0000-4000-8000-000000000601",
    );
    expect(resolveCase(suites, { name, platform: null })?.found.id).toBe(OVERSHOOT_CASE.caseId);
    expect(resolveCase(suites, { name, platform: "rig:gone" })?.found.id).toBe(OVERSHOOT_CASE.caseId);
  });

  it("says what became of a selection that was cleared", () => {
    expect(caseCleared(name, 1)).toBe(`${name} did not run on a rig in Build 1 — selection cleared.`);
    expect(caseOutOfScope(name, "telemetry integration")).toBe(
      `${name} is not in telemetry integration — selection cleared.`,
    );
  });
});
