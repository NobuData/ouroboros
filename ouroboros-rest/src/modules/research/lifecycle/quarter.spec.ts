import { parseQuarter, quarterOf, QUARTER_PATTERN } from "./quarter";

describe("quarterOf", () => {
  it.each([
    ["2026-01-01T00:00:00Z", "2026-Q1", "2026-01-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z"],
    ["2026-03-31T23:59:59Z", "2026-Q1", "2026-01-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z"],
    ["2026-04-01T00:00:00Z", "2026-Q2", "2026-04-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z"],
    ["2026-10-10T12:00:00Z", "2026-Q4", "2026-10-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
    ["2026-12-31T23:59:59Z", "2026-Q4", "2026-10-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
  ])("puts %s in %s", (instant, key, from, to) => {
    const quarter = quarterOf(new Date(instant));

    expect(quarter.key).toBe(key);
    expect(quarter.from.toISOString()).toBe(from);
    expect(quarter.to.toISOString()).toBe(to);
  });

  it("is half-open: the last instant belongs to the quarter and its end does not", () => {
    const quarter = quarterOf(new Date("2026-05-05T00:00:00Z"));

    expect(quarterOf(new Date(quarter.to.getTime() - 1)).key).toBe(quarter.key);
    expect(quarterOf(quarter.to).key).toBe("2026-Q3");
  });
});

describe("parseQuarter", () => {
  const now = new Date("2026-10-10T12:00:00Z");

  it("reads `current` from the clock", () => {
    expect(parseQuarter("current", now)?.key).toBe("2026-Q4");
  });

  it("reads a named quarter whatever the clock says", () => {
    const quarter = parseQuarter("2025-Q2", now);

    expect(quarter?.key).toBe("2025-Q2");
    expect(quarter?.from.toISOString()).toBe("2025-04-01T00:00:00.000Z");
    expect(quarter?.to.toISOString()).toBe("2025-07-01T00:00:00.000Z");
  });

  it.each([
    "",
    "2026",
    "2026-Q5",
    "2026-Q0",
    "2026-q1",
    "Q1-2026",
    "26-Q1",
    "current ",
    "2026-Q1x",
  ])("refuses %p", (value) => {
    expect(parseQuarter(value, now)).toBeUndefined();
    expect(QUARTER_PATTERN.test(value)).toBe(false);
  });
});
