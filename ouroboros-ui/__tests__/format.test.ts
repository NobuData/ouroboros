import { describe, expect, it } from "vitest";

import { compactNumber, durationOfMinutes, moneyOfCents } from "@/app/format";

/**
 * The formatters, at their boundaries.
 *
 * These are the functions [#81](https://github.com/NobuData/ouroboros/issues/81) asks for
 * tests of by name, and the reason is in its own problem statement: *"getting those
 * formatters subtly wrong — 999k rendering as `1000.0k`, 580 minutes as `9h 40m` or `9.7h`
 * — is the difference between the page looking designed and looking generated."* Every case
 * below is one of those, so each is a boundary rather than a sample.
 */

describe("compactNumber", () => {
  it("draws the mockup's token figure", () => {
    expect(compactNumber(4_200_000)).toBe("4.2M");
  });

  it("leaves a count that fits alone, with no unit and no decimal", () => {
    expect(compactNumber(0)).toBe("0");
    expect(compactNumber(27)).toBe("27");
    expect(compactNumber(999)).toBe("999");
  });

  it("compacts from a thousand, not before it", () => {
    expect(compactNumber(999)).toBe("999");
    expect(compactNumber(1000)).toBe("1.0k");
  });

  it("keeps one decimal place even when it is a zero, so a row does not reflow", () => {
    // `4M` one minute and `4.2M` the next would move every character of the tile beside it.
    expect(compactNumber(1_000_000)).toBe("1.0M");
    expect(compactNumber(12_000)).toBe("12.0k");
  });

  it("promotes a figure that rounding carried over its own unit", () => {
    // The issue's own boundary. `999,950 / 1000` is `999.95`, which is `1000.0k` to one
    // decimal — a number no compact scale should ever print.
    expect(compactNumber(999_950)).toBe("1.0M");
    expect(compactNumber(999_949)).toBe("999.9k");
  });

  it("carries at every boundary, not only at the first", () => {
    expect(compactNumber(999_999_950)).toBe("1.0B");
    expect(compactNumber(999_999_999_950)).toBe("1.0T");
  });

  it("rounds to the nearer tenth rather than truncating", () => {
    expect(compactNumber(1_150_000)).toBe("1.2M");
    expect(compactNumber(1_140_000)).toBe("1.1M");
  });

  it("climbs through every unit the product could reach", () => {
    expect(compactNumber(1_500)).toBe("1.5k");
    expect(compactNumber(1_500_000)).toBe("1.5M");
    expect(compactNumber(1_500_000_000)).toBe("1.5B");
    expect(compactNumber(1_500_000_000_000)).toBe("1.5T");
  });

  it("has no unit above a trillion, and says so rather than guessing one", () => {
    expect(compactNumber(1_000_000_000_000_000)).toBe("1000.0T");
  });

  it("rounds a fraction to a whole count before compacting anything", () => {
    expect(compactNumber(26.4)).toBe("26");
    expect(compactNumber(999.6)).toBe("1.0k");
  });

  it("keeps the sign on a negative, which no count on this page should be", () => {
    expect(compactNumber(-1_200)).toBe("-1.2k");
    expect(compactNumber(-8)).toBe("-8");
  });
});

describe("durationOfMinutes", () => {
  it("draws the mockup's queue estimate", () => {
    // 580 minutes. Not `9.7h`, and not `9h 40m` by luck: the two parts are computed apart.
    expect(durationOfMinutes(580)).toBe("9h 40m");
  });

  it("drops the hours below one, rather than printing a zero", () => {
    expect(durationOfMinutes(1)).toBe("1m");
    expect(durationOfMinutes(59)).toBe("59m");
  });

  it("drops the minutes when the span is whole hours", () => {
    expect(durationOfMinutes(60)).toBe("1h");
    expect(durationOfMinutes(120)).toBe("2h");
  });

  it("crosses the hour exactly once, in both directions", () => {
    expect(durationOfMinutes(59)).toBe("59m");
    expect(durationOfMinutes(60)).toBe("1h");
    expect(durationOfMinutes(61)).toBe("1h 1m");
  });

  it("draws zero as a duration rather than as nothing", () => {
    // A caller that means *there is no estimate* has to say so in words; this means zero.
    expect(durationOfMinutes(0)).toBe("0m");
  });

  it("goes on counting hours past a day, because a working estimate reads better that way", () => {
    expect(durationOfMinutes(1_440)).toBe("24h");
    expect(durationOfMinutes(2_170)).toBe("36h 10m");
  });

  it("rounds a fractional minute and refuses a negative one", () => {
    expect(durationOfMinutes(90.4)).toBe("1h 30m");
    expect(durationOfMinutes(90.6)).toBe("1h 31m");
    expect(durationOfMinutes(-5)).toBe("0m");
  });
});

describe("moneyOfCents", () => {
  it("draws the mockup's cost", () => {
    expect(moneyOfCents(1860)).toBe("$18.60");
  });

  it("always shows both cents, so a column of amounts lines up", () => {
    expect(moneyOfCents(0)).toBe("$0.00");
    expect(moneyOfCents(5)).toBe("$0.05");
    expect(moneyOfCents(50)).toBe("$0.50");
    expect(moneyOfCents(100)).toBe("$1.00");
  });

  it("groups thousands", () => {
    expect(moneyOfCents(123_456)).toBe("$1,234.56");
    expect(moneyOfCents(123_456_789)).toBe("$1,234,567.89");
    expect(moneyOfCents(99_999)).toBe("$999.99");
  });

  it("rounds the fraction of a cent the ledger is allowed to carry", () => {
    // `token_usage.cost_cents` is `numeric(14,4)`, so a half cent can reach this.
    expect(moneyOfCents(1860.4)).toBe("$18.60");
    expect(moneyOfCents(1860.5)).toBe("$18.61");
  });

  it("keeps the sign in front of the symbol", () => {
    expect(moneyOfCents(-1860)).toBe("-$18.60");
  });
});
