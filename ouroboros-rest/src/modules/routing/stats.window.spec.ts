import { statsWindow, STATS_WINDOW_DAYS } from "./stats.window";

/**
 * The window, and the two properties every figure on the routing page rests on.
 *
 * **It is measured back from the request instant**, which is the acceptance criterion *"window
 * arithmetic is relative to `now()`, matching the seeded windows"*. Y.4
 * ([#192](https://github.com/NobuData/ouroboros/issues/192)) places its calls inside a span
 * measured back from the moment the seed runs; a boundary taken from the first of the month
 * would read differently on the 1st than on the 28th over rows that had not moved.
 *
 * **It is one window per read**, so the matrix's average and the spend card's total are over
 * the same population. That is a property of the *caller* — `stats.service.ts` reads the clock
 * once — and what is asserted here is the half this file owns: the same `now` always yields the
 * same boundary, so two statements handed one window cannot disagree.
 */

/** An instant with no round numbers in it, so an arithmetic slip cannot land on the answer. */
const NOW = new Date("2026-08-23T09:58:12.004Z");

describe("the stats window", () => {
  it("looks back thirty days, which is what the card's own label claims", () => {
    expect(STATS_WINDOW_DAYS).toBe(30);
    expect(statsWindow(NOW).days).toBe(30);
  });

  it("measures back from the instant it was given, to the millisecond", () => {
    // A duration subtracted from `now`, not a calendar boundary: no timezone is involved and
    // the sub-second part survives, so a row cannot fall between two nearly-equal windows.
    expect(statsWindow(NOW).since.toISOString()).toBe("2026-07-24T09:58:12.004Z");
    expect(statsWindow(NOW).until).toBe(NOW);
  });

  it("crosses a daylight-saving boundary without moving, because it is a duration", () => {
    // 2026-03-29 is the morning European clocks go forward. A calendar-arithmetic window would
    // land an hour out; thirty times twenty-four hours does not know what a clock did.
    const spring = new Date("2026-03-30T01:30:00.000Z");

    expect(statsWindow(spring).since.toISOString()).toBe("2026-02-28T01:30:00.000Z");
  });

  it("answers the same boundary for the same instant, every time", () => {
    // The whole reason the instant is a parameter: two statements handed one window are
    // measuring one population, and a figure on the boundary is inside both or neither.
    expect(statsWindow(NOW).since).toEqual(statsWindow(NOW).since);
  });

  it("takes a width, for the report that will ask for another one", () => {
    // AB.4 (#210) drills into the same aggregation over a span the operator picks. The
    // parameter exists so that report does not arrive with a second window implementation.
    expect(statsWindow(NOW, 7).since.toISOString()).toBe("2026-08-16T09:58:12.004Z");
    expect(statsWindow(NOW, 7).days).toBe(7);
  });
});
