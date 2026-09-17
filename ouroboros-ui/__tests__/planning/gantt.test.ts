import { describe, expect, it } from "vitest";

import {
  DEFAULT_WINDOW_MONTHS,
  FIRST_MONTH_COLUMN,
  GANTT_FOOTNOTE,
  MOVE_ROLLED_BACK,
  READ_ONLY_STEP_REASON,
  SHARE_SOON_NOTE,
  STEPPERS,
  TODAY_LABEL,
  UNSCOPED_CHIP,
  UNSCOPED_STEP_REASON,
  barLabel,
  barPlacement,
  beginEdit,
  chipText,
  drawnLanes,
  editSpan,
  ganttColumns,
  ganttWindow,
  keyEdit,
  laneSpan,
  monthIndex,
  monthName,
  monthOf,
  monthText,
  monthsFromPixels,
  moveFailure,
  percentOf,
  progressPercent,
  sameSpan,
  settleEdit,
  spanLength,
  spanMonths,
  statusAffix,
  stepperLabel,
  stepperReason,
  todayDescription,
  todayOutside,
  todayPosition,
  windowFromLabel,
  withSpan,
} from "@/app/planning/gantt";

import { EMPTY_ROADMAP, SEEDED_READ_MONTH, planningEpic, seededRoadmap } from "../helpers/planning";

/**
 * The gantt's decisions (#286): which months, where a bar sits, where today is, and what a drag of so
 * many pixels means — each a function of plain values, so each acceptance criterion is exact here.
 */

/** A month's index, spelled for reading. */
const month = (text: string) => monthIndex(text)!;

/** The seed's window: Jul–Dec 2026. */
const HELIOS = { first: month("2026-07"), last: month("2026-12") };

describe("months", () => {
  it("round-trips YYYY-MM through an index, across a year boundary", () => {
    expect(monthIndex("2026-07")).toBe(2026 * 12 + 6);
    expect(monthText(month("2026-12") + 1)).toBe("2027-01");
    expect(monthText(month("2027-01") - 1)).toBe("2026-12");
  });

  it("refuses what is not a month", () => {
    expect(monthIndex("2026-13")).toBeNull();
    expect(monthIndex("2026-7")).toBeNull();
    expect(monthIndex("July")).toBeNull();
  });

  it("reads an instant's month in the local calendar", () => {
    expect(monthOf(new Date(2026, 7, 8, 12))).toBe(month("2026-08"));
    expect(monthName(month("2026-08"))).toBe("Aug 2026");
  });
});

describe("windowFromLabel", () => {
  it.each([
    ["Q3–Q4 2026", "2026-07", "2026-12"],
    ["Q3-Q4 2026", "2026-07", "2026-12"],
    ["Q4 2026–Q1 2027", "2026-10", "2027-03"],
    ["Q3 2026", "2026-07", "2026-09"],
    ["H2 2026", "2026-07", "2026-12"],
    ["Jul–Dec 2026", "2026-07", "2026-12"],
    ["Sep 2026 to Feb 2027", "2026-09", "2027-02"],
    ["september 2026", "2026-09", "2026-09"],
  ])("reads %s as %s to %s", (label, first, last) => {
    expect(windowFromLabel(label)).toEqual({ first: month(first), last: month(last) });
  });

  it.each([[null], ["Next quarter"], ["Q3–Q4"], ["H3 2026"], ["Q4–Q1 2026"], ["Q1 – Q2 – Q3 2026"], ["Foo 2026"]])(
    "reads %s as nothing",
    (label) => {
      expect(windowFromLabel(label)).toBeNull();
    },
  );
});

describe("ganttWindow", () => {
  it("is the seed's Q3–Q4 2026: the mockup's Jul–Dec", () => {
    expect(ganttWindow(seededRoadmap(), SEEDED_READ_MONTH)).toEqual(HELIOS);
  });

  it("widens the label to cover every scheduled lane", () => {
    const roadmap = {
      window: "Q3 2026",
      lanes: [planningEpic({ startMonth: "2026-06", endMonth: "2027-01" }), planningEpic({ startMonth: null, endMonth: null })],
    };

    expect(ganttWindow(roadmap, SEEDED_READ_MONTH)).toEqual({ first: month("2026-06"), last: month("2027-01") });
  });

  it("is the lanes' span when the label says nothing parseable", () => {
    const roadmap = { window: "Soon", lanes: [planningEpic({ startMonth: "2026-09", endMonth: "2026-10" })] };

    expect(ganttWindow(roadmap, SEEDED_READ_MONTH)).toEqual({ first: month("2026-09"), last: month("2026-10") });
  });

  it("is six months from the read when there is nothing to go on", () => {
    const window = ganttWindow({ window: null, lanes: [planningEpic({ startMonth: null, endMonth: null })] }, SEEDED_READ_MONTH);

    expect(window).toEqual({ first: SEEDED_READ_MONTH, last: SEEDED_READ_MONTH + DEFAULT_WINDOW_MONTHS - 1 });
    expect(ganttWindow(EMPTY_ROADMAP, SEEDED_READ_MONTH)).toEqual(window);
  });
});

describe("ganttColumns", () => {
  it("labels the mockup's Jul 2026 · Aug · Sep · Oct · Nov · Dec, after the label column", () => {
    const columns = ganttColumns(HELIOS);

    expect(columns.map((column) => column.label)).toEqual(["Jul 2026", "Aug", "Sep", "Oct", "Nov", "Dec"]);
    expect(columns.map((column) => column.column)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(columns[0]!.month).toBe("2026-07");
  });

  it("names the year again at every January", () => {
    const labels = ganttColumns({ first: month("2026-11"), last: month("2027-02") }).map((column) => column.label);

    expect(labels).toEqual(["Nov 2026", "Dec", "Jan 2027", "Feb"]);
  });
});

describe("bars", () => {
  it("places the seed's lanes on the mockup's grid columns", () => {
    const placements = seededRoadmap().lanes.map((lane) => barPlacement(lane, HELIOS));

    expect(placements.map((placement) => [placement.columnStart, placement.columnEnd])).toEqual([
      [2, 5],
      [3, 6],
      [4, 7],
      [5, 8],
      [6, 8],
    ]);
    expect(placements.map((placement) => placement.scheduled)).toEqual([true, true, true, true, false]);
  });

  it("draws an unscoped lane in a one-month window across that month", () => {
    const one = { first: month("2026-07"), last: month("2026-07") };

    expect(barPlacement({ startMonth: null, endMonth: null }, one)).toEqual({
      columnStart: FIRST_MONTH_COLUMN,
      columnEnd: FIRST_MONTH_COLUMN + 1,
      scheduled: false,
    });
  });

  it("clamps a lane that runs past the window", () => {
    expect(barPlacement({ startMonth: "2026-05", endMonth: "2027-03" }, HELIOS)).toEqual({
      columnStart: 2,
      columnEnd: 8,
      scheduled: true,
    });
  });

  it("fills to the computed done-fraction, and not at all for a lane with no tickets", () => {
    expect(progressPercent({ issues: 12, done: 8 })).toBe(67);
    expect(progressPercent({ issues: 9, done: 2 })).toBe(22);
    expect(progressPercent({ issues: 14, done: 0 })).toBe(0);
    expect(progressPercent({ issues: 3, done: 5 })).toBe(100);
    expect(progressPercent({ issues: 0, done: 0 })).toBeNull();
  });

  it("chips `N issues · M done`, singular for one, and `unscoped` for a rangeless lane", () => {
    expect(chipText(planningEpic())).toBe("12 issues · 8 done");
    expect(chipText(planningEpic({ chips: { issues: 1, done: 0 } }))).toBe("1 issue · 0 done");
    expect(chipText(planningEpic({ startMonth: null, endMonth: null }))).toBe(UNSCOPED_CHIP);
  });

  it("affixes proposed and done, and says nothing for active or unscoped", () => {
    expect(statusAffix("proposed")).toBe("proposed");
    expect(statusAffix("done")).toBe("done");
    expect(statusAffix("active")).toBeNull();
    expect(statusAffix("unscoped")).toBeNull();
  });

  it("names a bar with its months, chip and status for a screen reader", () => {
    expect(barLabel(planningEpic())).toBe("OTA hardening — Jul 2026 to Sep 2026 — 12 issues · 8 done");
    expect(barLabel(planningEpic({ name: "Zephyr", startMonth: null, endMonth: null, status: "proposed" }))).toBe(
      "Zephyr — no months yet — unscoped — proposed",
    );
  });

  it("reads a lane's span, and none for unscoped or malformed months", () => {
    expect(laneSpan(planningEpic())).toEqual({ first: month("2026-07"), last: month("2026-09") });
    expect(laneSpan({ startMonth: null, endMonth: null })).toBeNull();
    expect(laneSpan({ startMonth: "2026-09", endMonth: "2026-07" })).toBeNull();
    expect(laneSpan({ startMonth: "July", endMonth: "2026-07" })).toBeNull();
    expect(spanLength(HELIOS)).toBe(6);
  });
});

describe("todayPosition — the marker is placed from the real date, not eyeballed", () => {
  it("puts Aug 8 2026, midnight, exactly 7/31 through August — the grid's third column", () => {
    const position = todayPosition(new Date(2026, 7, 8), HELIOS);

    expect(position).toEqual({ within: true, column: 3, fraction: 7 / 31 });
  });

  it("puts noon on Aug 8 at 7.5/31", () => {
    const position = todayPosition(new Date(2026, 7, 8, 12), HELIOS);

    expect(position.within && position.fraction).toBeCloseTo(7.5 / 31, 10);
  });

  it("is 0 at the first instant of a month and just under 1 at its last", () => {
    const first = todayPosition(new Date(2026, 8, 1), HELIOS);
    const last = todayPosition(new Date(2026, 9, 1, 0, 0, 0, -1), HELIOS);

    expect(first).toEqual({ within: true, column: 4, fraction: 0 });
    expect(last.within && last.fraction).toBeGreaterThan(0.9999);
    expect(last.within && last.fraction).toBeLessThan(1);
    expect(last.within && last.column).toBe(4);
  });

  it("measures February in its own length", () => {
    const window = { first: month("2027-02"), last: month("2027-02") };

    expect(todayPosition(new Date(2027, 1, 15), window)).toEqual({ within: true, column: 2, fraction: 14 / 28 });
  });

  it("says which side a today outside the window is on", () => {
    expect(todayPosition(new Date(2026, 5, 30), HELIOS)).toEqual({ within: false, side: "before" });
    expect(todayPosition(new Date(2027, 0, 1), HELIOS)).toEqual({ within: false, side: "after" });
    expect(todayOutside("before")).toMatch(/before/);
    expect(todayOutside("after")).toMatch(/after/);
  });

  it("writes the fraction as a CSS percentage, finer than a pixel", () => {
    expect(percentOf(7 / 31)).toBe("22.581%");
    expect(percentOf(0)).toBe("0%");
  });

  it("labels the marker as the mockup does, and describes the date", () => {
    expect(TODAY_LABEL).toBe("TODAY");
    expect(todayDescription(new Date(2026, 7, 8))).toBe("Today, 8 August 2026");
  });
});

describe("editing a range — the month snap", () => {
  it("snaps pixels to the nearest whole month", () => {
    expect(monthsFromPixels(149, 100)).toBe(1);
    expect(monthsFromPixels(151, 100)).toBe(2);
    expect(monthsFromPixels(-49, 100)).toBe(0);
    expect(Object.is(monthsFromPixels(-20, 100), 0)).toBe(true);
    expect(monthsFromPixels(-260, 100)).toBe(-3);
    expect(monthsFromPixels(500, 0)).toBe(0);
  });

  const ota = { first: month("2026-07"), last: month("2026-09") };

  it("moves a bar keeping its length, and stops it at the window's edges", () => {
    expect(editSpan(ota, "move", 2, HELIOS)).toEqual({ first: month("2026-09"), last: month("2026-11") });
    expect(editSpan(ota, "move", 9, HELIOS)).toEqual({ first: month("2026-10"), last: month("2026-12") });
    expect(editSpan(ota, "move", -1, HELIOS)).toBe(ota);
  });

  it("resizes from either edge, never past the window and never shorter than a month", () => {
    expect(editSpan(ota, "end", 2, HELIOS)).toEqual({ first: month("2026-07"), last: month("2026-11") });
    expect(editSpan(ota, "end", -5, HELIOS)).toEqual({ first: month("2026-07"), last: month("2026-07") });
    expect(editSpan(ota, "start", 5, HELIOS)).toEqual({ first: month("2026-09"), last: month("2026-09") });
    expect(editSpan(ota, "start", -1, HELIOS)).toBe(ota);
    expect(editSpan(ota, "end", 10, HELIOS)).toEqual({ first: month("2026-07"), last: month("2026-12") });
  });

  it("compares spans and spells them as the contract's months", () => {
    expect(sameSpan(ota, { ...ota })).toBe(true);
    expect(sameSpan(ota, HELIOS)).toBe(false);
    expect(spanMonths(ota)).toEqual({ startMonth: "2026-07", endMonth: "2026-09" });
    expect(withSpan(planningEpic(), HELIOS)).toMatchObject({ startMonth: "2026-07", endMonth: "2026-12" });
  });
});

describe("the steppers — the keyboard's drag", () => {
  const [startEarlier, startLater, moveEarlier, moveLater, endEarlier, endLater] = STEPPERS;

  it("offers start, move and end, each earlier and later", () => {
    expect(STEPPERS.map((stepper) => `${stepper.edit}${String(stepper.months)}`)).toEqual([
      "start-1",
      "start1",
      "move-1",
      "move1",
      "end-1",
      "end1",
    ]);
    expect(stepperLabel(moveLater!, "OTA hardening")).toBe("Move OTA hardening a month later");
    expect(stepperLabel(endEarlier!, "OTA hardening")).toBe("End OTA hardening a month earlier");
  });

  it("acts where the edit can move the lane", () => {
    const lane = planningEpic({ startMonth: "2026-08", endMonth: "2026-10" });

    for (const stepper of STEPPERS) expect(stepperReason(stepper, lane, HELIOS, true)).toBeUndefined();
  });

  it("says why it cannot act at an edge, at one month, for an unscoped lane, or for a reader", () => {
    const ota = planningEpic();
    const single = planningEpic({ startMonth: "2026-09", endMonth: "2026-09" });

    expect(stepperReason(moveEarlier!, ota, HELIOS, true)).toBe("Already at the roadmap's first month.");
    expect(stepperReason(startEarlier!, ota, HELIOS, true)).toBe("Already at the edge of the roadmap.");
    expect(stepperReason(moveLater!, planningEpic({ startMonth: "2026-10", endMonth: "2026-12" }), HELIOS, true)).toBe(
      "Already at the roadmap's last month.",
    );
    expect(stepperReason(endLater!, planningEpic({ startMonth: "2026-10", endMonth: "2026-12" }), HELIOS, true)).toBe(
      "Already at the edge of the roadmap.",
    );
    expect(stepperReason(startLater!, single, HELIOS, true)).toBe("An epic runs at least one month.");
    expect(stepperReason(endEarlier!, single, HELIOS, true)).toBe("An epic runs at least one month.");
    expect(stepperReason(moveLater!, planningEpic({ startMonth: null, endMonth: null }), HELIOS, true)).toBe(
      UNSCOPED_STEP_REASON,
    );
    expect(stepperReason(moveLater!, ota, HELIOS, false)).toBe(READ_ONLY_STEP_REASON);
  });

  it("maps arrows to move, Shift + arrows to the end, Alt + arrows to the start", () => {
    const none = { shiftKey: false, altKey: false };

    expect(keyEdit("ArrowRight", none)).toEqual({ edit: "move", months: 1 });
    expect(keyEdit("ArrowLeft", none)).toEqual({ edit: "move", months: -1 });
    expect(keyEdit("ArrowRight", { shiftKey: true, altKey: false })).toEqual({ edit: "end", months: 1 });
    expect(keyEdit("ArrowLeft", { shiftKey: false, altKey: true })).toEqual({ edit: "start", months: -1 });
    expect(keyEdit("Enter", none)).toBeNull();
    expect(keyEdit("ArrowUp", none)).toBeNull();
  });
});

describe("an edit in flight — optimistic, rolled back cleanly", () => {
  const ota = planningEpic();
  const moved = withSpan(ota, { first: month("2026-08"), last: month("2026-10") });
  const movedAgain = withSpan(ota, { first: month("2026-09"), last: month("2026-11") });

  it("draws the asked-for lane while the service answers", () => {
    const pending = beginEdit(new Map(), ota, moved, 1);

    expect(drawnLanes([ota], new Map(), pending)).toEqual([moved]);
  });

  it("keeps the stored lane on success", () => {
    const pending = beginEdit(new Map(), ota, moved, 1);
    const result = settleEdit(pending, ota.id, 1, moved);

    expect(result).toEqual({ pending: new Map(), settled: moved, rolledBack: false });
    expect(drawnLanes([ota], new Map([[ota.id, moved]]), result.pending)).toEqual([moved]);
  });

  it("rolls a refused change back to the lane the service last confirmed", () => {
    const pending = beginEdit(new Map(), ota, moved, 1);
    const result = settleEdit(pending, ota.id, 1, null);

    expect(result).toEqual({ pending: new Map(), settled: ota, rolledBack: true });
  });

  it("stacks a second change on the first, keeping the first's rollback point", () => {
    const first = beginEdit(new Map(), ota, moved, 1);
    const second = beginEdit(first, moved, movedAgain, 2);

    expect(second.get(ota.id)).toEqual({ shown: movedAgain, confirmed: ota, sequence: 2 });

    // The first's answer is stale: nothing is drawn from it, but its stored lane is the new rollback point.
    const stale = settleEdit(second, ota.id, 1, moved);

    expect(stale.settled).toBeNull();
    expect(stale.pending.get(ota.id)).toEqual({ shown: movedAgain, confirmed: moved, sequence: 2 });

    const refused = settleEdit(stale.pending, ota.id, 2, null);

    expect(refused).toEqual({ pending: new Map(), settled: moved, rolledBack: true });
  });

  it("ignores a stale refusal, and an answer for a lane with nothing in flight", () => {
    const second = beginEdit(beginEdit(new Map(), ota, moved, 1), moved, movedAgain, 2);

    expect(settleEdit(second, ota.id, 1, null)).toEqual({ pending: second, settled: null, rolledBack: false });
    expect(settleEdit(new Map(), ota.id, 1, moved)).toEqual({ pending: new Map(), settled: null, rolledBack: false });
  });

  it("says what was refused, and that the bar is back", () => {
    expect(moveFailure("OTA hardening", "forbidden")).toBe(
      `OTA hardening could not be moved. ${READ_ONLY_STEP_REASON} ${MOVE_ROLLED_BACK}`,
    );
    expect(moveFailure("OTA", "epic_month_range_invalid")).toMatch(/do not run forwards/);
    expect(moveFailure("OTA", "planning_epic_not_found")).toMatch(/no longer exists/);
    expect(moveFailure("OTA", "internal_error")).toMatch(/could not be saved\. It is back where it was\.$/);
  });
});

describe("the card's copy", () => {
  it("softens the footnote to what is true today — re-planning is #293's", () => {
    expect(GANTT_FOOTNOTE).toBe("Bars are epics; Ouroboros keeps them in sync with the trackers.");
    expect(GANTT_FOOTNOTE).not.toMatch(/re-plan/i);
  });

  it("names the issue that builds sharing", () => {
    expect(SHARE_SOON_NOTE).toMatch(/#292/);
  });
});
