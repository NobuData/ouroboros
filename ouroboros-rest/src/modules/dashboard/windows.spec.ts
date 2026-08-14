import {
  DASHBOARD_TIME_ZONE,
  MERGE_RATE_WINDOW_DAYS,
  PULSE_WINDOW_DAYS,
  dashboardWindows,
  dayOf,
  startOfDay,
} from "./windows";

/**
 * The boundaries, and the four ways a window goes wrong.
 *
 * Windows are the part of this endpoint that fails quietly: an off-by-one on a boundary
 * changes a number by one row and nothing throws. So each of the cases #72 names is asserted
 * here rather than left to a seed to expose — an empty window, a single run, a run sitting
 * exactly on a boundary, and a clock that moved because a zone changed its offset.
 *
 * These are unit tests of *arithmetic*, deliberately: they need no database, and the rows a
 * window selects are `dashboard.integration-spec.ts`'s question.
 */

/** A moment with nothing round about it — mid-month, mid-hour, with milliseconds. */
const NOW = new Date("2026-08-13T14:37:41.532Z");

/** Milliseconds in a day, restated here so the assertions do not borrow the implementation's. */
const DAY = 86_400_000;

describe("the dashboard's windows", () => {
  it("measures the rolling windows as durations back from the request instant", () => {
    const windows = dashboardWindows(NOW);

    expect(windows.now).toEqual(NOW);
    expect(NOW.getTime() - windows.weekStart.getTime()).toBe(PULSE_WINDOW_DAYS * DAY);
    expect(NOW.getTime() - windows.priorWeekStart.getTime()).toBe(MERGE_RATE_WINDOW_DAYS * DAY);
  });

  it("makes the prior week's start and the merge rate's window one instant", () => {
    // Not a coincidence to be tidied away later: the rate is measured over exactly the span
    // the merged delta already compares across, which is why one field serves both.
    expect(MERGE_RATE_WINDOW_DAYS).toBe(PULSE_WINDOW_DAYS * 2);
    expect(dashboardWindows(NOW).priorWeekStart.getTime()).toBe(
      dashboardWindows(NOW).weekStart.getTime() - PULSE_WINDOW_DAYS * DAY,
    );
  });

  it("leaves the two windows adjacent, so no run is in both and none is in neither", () => {
    // `[priorWeekStart, weekStart)` and `[weekStart, now]`. The repository's predicates are
    // half-open on the same instant, so a run that finished exactly at `weekStart` is counted
    // once — in *this* week — and the delta is a comparison rather than a double count.
    const { weekStart, priorWeekStart } = dashboardWindows(NOW);

    expect(weekStart.getTime()).toBeGreaterThan(priorWeekStart.getTime());
    expect(weekStart.getTime() - priorWeekStart.getTime()).toBe(PULSE_WINDOW_DAYS * DAY);
  });

  it("takes the day boundary in UTC, and says so", () => {
    expect(DASHBOARD_TIME_ZONE).toBe("UTC");

    const { dayStart, day } = dashboardWindows(NOW);

    expect(dayStart.toISOString()).toBe("2026-08-13T00:00:00.000Z");
    expect(day).toBe("2026-08-13");
  });

  it("puts midnight itself at the start of its own day, not the end of the one before", () => {
    // The boundary case a `<` where a `<=` belongs gets wrong, and the one that makes "merged
    // since this morning" report yesterday's merges for the first millisecond of a day.
    const midnight = new Date("2026-08-13T00:00:00.000Z");

    expect(startOfDay(midnight).toISOString()).toBe("2026-08-13T00:00:00.000Z");
    expect(dayOf(midnight)).toBe("2026-08-13");
  });

  it("keeps the last millisecond of a day inside it", () => {
    const lastInstant = new Date("2026-08-13T23:59:59.999Z");

    expect(startOfDay(lastInstant).toISOString()).toBe("2026-08-13T00:00:00.000Z");
    expect(dayOf(lastInstant)).toBe("2026-08-13");
  });

  it("zero-pads the day, because the view's key is text and `2026-8-3` matches nothing", () => {
    expect(dayOf(new Date("2026-01-03T09:00:00.000Z"))).toBe("2026-01-03");
  });
});

describe("a day boundary in a zone that observes daylight saving", () => {
  /**
   * The dashboard is on UTC today and these assertions are not therefore hypothetical: the
   * day boundary is computed through a zone-aware helper *so that* a per-workspace timezone
   * is a parameter rather than a rewrite, and a helper whose DST behaviour nothing checks is
   * one that will be wrong on the day it is first needed.
   *
   * `America/Denver` — the zone this repository's clock keeps — springs forward at 02:00 on
   * 8 March 2026 and falls back at 02:00 on 1 November 2026.
   */
  const DENVER = "America/Denver";

  it("finds midnight on the day a zone loses an hour", () => {
    // 2026-03-08 begins at 07:00Z (MST, −07:00) and the offset becomes −06:00 at 09:00Z.
    // An instant after the transition still belongs to a day that began under the *old*
    // offset, which is exactly what epoch arithmetic on a fixed offset gets wrong.
    const afterSpringForward = new Date("2026-03-08T18:00:00.000Z");

    expect(startOfDay(afterSpringForward, DENVER).toISOString()).toBe("2026-03-08T07:00:00.000Z");
    expect(dayOf(afterSpringForward, DENVER)).toBe("2026-03-08");
  });

  it("finds midnight on the day a zone gains one", () => {
    // 2026-11-01 begins at 06:00Z (MDT, −06:00); the offset becomes −07:00 at 08:00Z.
    const afterFallBack = new Date("2026-11-01T20:00:00.000Z");

    expect(startOfDay(afterFallBack, DENVER).toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(dayOf(afterFallBack, DENVER)).toBe("2026-11-01");
  });

  it("names the day the zone is in, not the day UTC is in", () => {
    // 19:00 in Denver is the following day in UTC. A subline reading "since this morning"
    // against the wrong one of those is off by a whole day for seven hours out of twenty-four.
    const evening = new Date("2026-08-14T01:00:00.000Z");

    expect(dayOf(evening, DENVER)).toBe("2026-08-13");
    expect(dayOf(evening)).toBe("2026-08-14");
  });

  it("leaves the rolling windows untouched by any of it", () => {
    // The property the header claims: a duration in milliseconds does not know what a clock
    // did. Measured across the spring-forward transition, seven days is still seven days.
    const acrossTheTransition = new Date("2026-03-09T12:00:00.000Z");
    const windows = dashboardWindows(acrossTheTransition, DENVER);

    expect(acrossTheTransition.getTime() - windows.weekStart.getTime()).toBe(
      PULSE_WINDOW_DAYS * DAY,
    );
  });

  it("finds the start of a day whose midnight never happened", () => {
    // Santiago springs forward *at* midnight: on 2026-09-06 the clocks go straight from
    // 23:59:59 on the 5th to 01:00 on the 6th, so "midnight local" is an instant that does
    // not exist. The day still began — at the transition — and that is the answer, rather
    // than an hour of the previous day masquerading as the start of this one.
    const santiago = "America/Santiago";
    const duringTheDay = new Date("2026-09-06T18:00:00.000Z");

    const start = startOfDay(duringTheDay, santiago);

    expect(dayOf(start, santiago)).toBe("2026-09-06");
    expect(start.toISOString()).toBe("2026-09-06T04:00:00.000Z");
    // And nothing before it belongs to that day, which is the property the boundary is for.
    expect(dayOf(new Date(start.getTime() - 1), santiago)).toBe("2026-09-05");
  });

  it("refuses a zone the runtime does not know rather than guessing UTC", () => {
    // Guessing would mis-date a whole workspace's day and report nothing at all about it.
    expect(() => startOfDay(NOW, "Mars/Olympus_Mons")).toThrow(RangeError);
  });
});
