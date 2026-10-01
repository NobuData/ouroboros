import { formatCompact, formatCountWord, formatDuration, formatShare } from "./page.format";

describe("formatDuration", () => {
  it.each([
    [40_000, "40s"],
    [60_000, "1m"],
    [120_000, "2m"],
    [364_000, "6m 04s"],
    [500_000, "8m 20s"],
    [860_000, "14m 20s"],
    [2_880_000, "48m"],
    [7_800_000, "2h 10m"],
    [7_200_000, "2h"],
    [0, "0s"],
    // Rounded to the second, then carried.
    [59_600, "1m"],
  ])("prints %d ms as %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe("formatCompact", () => {
  it.each([
    [126_000_000, "126M"],
    [4_600_000, "4.6M"],
    [1_298_969, "1.3M"],
    [3_000_000, "3M"],
    [26_430, "26.4k"],
    [8_000, "8k"],
    [980, "980"],
    [0, "0"],
  ])("prints %d as %s", (value, text) => {
    expect(formatCompact(value)).toBe(text);
  });
});

describe("formatShare", () => {
  it.each([
    [8, 20, "40%"],
    [33, 26_430, "0.12%"],
    [39_060_000, 126_000_000, "31%"],
    [0, 20, "0%"],
    [20, 20, "100%"],
  ])("prints %d of %d as %s", (part, whole, text) => {
    expect(formatShare(part, whole)).toBe(text);
  });
});

describe("formatCountWord", () => {
  it("spells a small count and prints a large one", () => {
    expect([1, 5, 9, 10, 12].map(formatCountWord)).toEqual(["one", "five", "nine", "10", "12"]);
  });
});
