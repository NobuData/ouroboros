import { describe, expect, it } from "vitest";

import {
  MAX_CENTS,
  amountOfCents,
  centsOfAmount,
  chipAmount,
  isAmountInProgress,
} from "@/app/policies/money";

/**
 * Money on the Autonomy policies card (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)):
 * a typed amount becomes integer cents with no floating point between, and comes back as the
 * text it was — so a spend guard never fires a cent early.
 */

describe("centsOfAmount", () => {
  it.each([
    ["2.50", 250],
    ["600", 60_000],
    ["19.9", 1990],
    // Each of these drifts when multiplied by a hundred as a float.
    ["19.99", 1999],
    ["0.07", 7],
    ["1.15", 115],
    ["8.2", 820],
    ["1234567.89", 123_456_789],
    ["0.01", 1],
    ["21474836.47", MAX_CENTS],
    [" 2.50 ", 250],
  ])("reads %s as %i cents, exactly", (text, cents) => {
    expect(centsOfAmount(text)).toBe(cents);
  });

  it.each(["", "0", "0.0", "0.00", "2.", ".5", "2.505", "abc", "-1", "1e3", "1,000", "21474836.48", "123456789"])(
    "refuses %j — not an amount the document admits",
    (text) => {
      expect(centsOfAmount(text)).toBeNull();
    },
  );
});

describe("isAmountInProgress", () => {
  it.each(["", "2", "2.", "2.5", "2.50", ".", ".5", "12345678"])("lets %j be typed", (text) => {
    expect(isAmountInProgress(text)).toBe(true);
  });

  it.each(["2.505", "a", "2a", "-", "1e", "1,0", "123456789", "2..", " 2"])(
    "never lets %j into the field — a third decimal is unreachable",
    (text) => {
      expect(isAmountInProgress(text)).toBe(false);
    },
  );
});

describe("amountOfCents and chipAmount", () => {
  it.each([
    [250, "2.50", "$2.50"],
    [60_000, "600", "$600"],
    [1999, "19.99", "$19.99"],
    [7, "0.07", "$0.07"],
    [100, "1", "$1"],
    [123_456_789, "1234567.89", "$1,234,567.89"],
    [120_000, "1200", "$1,200"],
    [MAX_CENTS, "21474836.47", "$21,474,836.47"],
  ])("draws %i cents as %s for editing and %s on a chip", (cents, amount, chip) => {
    expect(amountOfCents(cents)).toBe(amount);
    expect(chipAmount(cents)).toBe(chip);
  });

  it("round-trips every cent of the first ten thousand with no drift", () => {
    for (let cents = 1; cents <= 10_000; cents += 1) {
      expect(centsOfAmount(amountOfCents(cents))).toBe(cents);
    }
  });
});
