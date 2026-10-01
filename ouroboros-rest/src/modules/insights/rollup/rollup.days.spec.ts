import { addDays, dayBounds, dayStart, isDay, maxDay, minDay, utcDay } from "./rollup.days";

/** UTC day arithmetic (BI.2, #433): the grain's days are UTC, whatever the server's zone. */

describe("UTC days", () => {
  it.each(["2026-08-04", "2024-02-29", "2026-12-31"])("accepts the real day %s", (day) => {
    expect(isDay(day)).toBe(true);
  });

  it.each(["2026-02-30", "2026-8-4", "2026-13-01", "20260804", "", "2026-08-04T00:00:00Z"])(
    "refuses %j",
    (value) => {
      expect(isDay(value)).toBe(false);
    },
  );

  it("names the UTC day of an instant, not the local one", () => {
    expect(utcDay(new Date("2026-08-04T23:59:59.999Z"))).toBe("2026-08-04");
    expect(utcDay(new Date("2026-08-05T00:00:00.000Z"))).toBe("2026-08-05");
  });

  it("moves across month, year and leap-day boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-09-01", -90)).toBe("2026-06-03");
    expect(addDays("2026-09-01", 0)).toBe("2026-09-01");
  });

  it("bounds a day as the half-open range [midnight, next midnight)", () => {
    expect(dayStart("2026-08-04")).toEqual(new Date("2026-08-04T00:00:00.000Z"));
    expect(dayBounds("2026-08-04")).toEqual({
      from: new Date("2026-08-04T00:00:00.000Z"),
      to: new Date("2026-08-05T00:00:00.000Z"),
    });
  });

  it("orders days as dates", () => {
    expect(minDay("2026-08-04", "2026-07-31")).toBe("2026-07-31");
    expect(maxDay("2026-08-04", "2026-07-31")).toBe("2026-08-04");
  });
});
