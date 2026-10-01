import { addDays } from "../rollup/rollup.days";
import {
  daysOf,
  isMetricRange,
  METRIC_RANGES,
  rangeDays,
  resolveWindow,
  type MetricRange,
} from "./metrics.window";

/**
 * Range resolution (BJ.1, #437): the window matrix, as arithmetic.
 *
 * Every range × every boundary case × every caller offset resolves to N whole UTC days ending
 * today, with the prior window the N days immediately before it.
 */

/** Boundary cases: month ends, a leap day, a year end, a Monday and a Sunday. */
const BOUNDARIES: readonly [string, string][] = [
  ["the first of a month", "2026-09-01T12:00:00.000Z"],
  ["the last of a 31-day month", "2026-08-31T23:59:59.999Z"],
  ["the first instant of a day", "2026-03-01T00:00:00.000Z"],
  ["a leap day", "2028-02-29T10:00:00.000Z"],
  ["new year's day", "2027-01-01T00:30:00.000Z"],
  ["a Monday", "2026-08-10T08:00:00.000Z"],
  ["a Sunday", "2026-08-16T22:00:00.000Z"],
];

/** Offsets a caller's clock might be written in, in minutes east of UTC. */
const OFFSETS = [-720, -300, 0, 330, 840];

/**
 * An instant written in another offset — the same instant, a different wall clock.
 *
 * @param at - The instant, as UTC ISO.
 * @param minutes - The offset.
 * @returns The ISO string in that offset.
 */
function inOffset(at: string, minutes: number): string {
  const shifted = new Date(new Date(at).getTime() + minutes * 60_000).toISOString().slice(0, 23);
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");

  return `${shifted}${sign}${hh}:${mm}`;
}

describe("metrics window resolution", () => {
  describe.each(METRIC_RANGES.map((range) => [range]))("%s", (range: MetricRange) => {
    const n = rangeDays(range);

    it.each(BOUNDARIES)("on %s, at every caller offset, resolves the same UTC days", (_, at) => {
      const today = at.slice(0, 10);

      for (const offset of OFFSETS) {
        const window = resolveWindow(range, new Date(inOffset(at, offset)));

        expect(window.today).toBe(today);
        expect(window.current).toEqual({ from: addDays(today, -(n - 1)), to: today });
        expect(daysOf(window.current)).toHaveLength(n);
        expect(daysOf(window.prior)).toHaveLength(n);
        // Adjacent: the prior window ends the day before the window starts.
        expect(addDays(window.prior.to, 1)).toBe(window.current.from);
        // The scan reads the prior window and the window up to yesterday, never today.
        expect(window.scan).toEqual({ from: window.prior.from, to: addDays(today, -1) });
      }
    });
  });

  it("treats a window crossing a month end as consecutive days, not a calendar month", () => {
    const window = resolveWindow("30d", new Date("2026-09-05T12:00:00.000Z"));

    expect(window.current).toEqual({ from: "2026-08-07", to: "2026-09-05" });
    expect(window.prior).toEqual({ from: "2026-07-08", to: "2026-08-06" });
  });

  it("does not snap a week to Monday", () => {
    const window = resolveWindow("7d", new Date("2026-08-13T14:00:00.000Z"));

    expect(window.current).toEqual({ from: "2026-08-07", to: "2026-08-13" });
    expect(window.prior).toEqual({ from: "2026-07-31", to: "2026-08-06" });
  });

  it("moves the window at midnight UTC, not at a caller's midnight", () => {
    const before = resolveWindow("7d", new Date("2026-08-13T23:59:59.999Z"));
    const after = resolveWindow("7d", new Date("2026-08-14T00:00:00.000Z"));
    // 19:30 in New York on the 13th is already the 14th in UTC.
    const newYorkEvening = resolveWindow("7d", new Date("2026-08-13T20:30:00.000-04:00"));

    expect(before.today).toBe("2026-08-13");
    expect(after.today).toBe("2026-08-14");
    expect(newYorkEvening.today).toBe("2026-08-14");
  });

  it("refuses an invalid instant", () => {
    expect(() => resolveWindow("7d", new Date("not a date"))).toThrow(RangeError);
  });

  it("recognises the offered ranges and nothing else", () => {
    expect(METRIC_RANGES.every(isMetricRange)).toBe(true);
    expect(isMetricRange("14d")).toBe(false);
    expect(isMetricRange(7)).toBe(false);
    expect(isMetricRange(undefined)).toBe(false);
  });

  it("lists a span's days in order", () => {
    expect(daysOf({ from: "2026-02-27", to: "2026-03-02" })).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
    expect(daysOf({ from: "2026-03-02", to: "2026-03-01" })).toEqual([]);
  });
});
