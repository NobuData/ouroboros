import {
  NO_FIGURE,
  formatCompact,
  formatCount,
  formatCountWord,
  formatDelta,
  formatDuration,
  formatFigure,
  formatMoney,
  formatPercent,
  formatShare,
} from "./page.format";

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

describe("formatMoney", () => {
  it.each([
    [187, "$1.87"],
    [187.3956, "$1.87"],
    [3_140, "$31.40"],
    [11_800, "$118"],
    [120_450, "$1,204.50"],
    [0, "$0"],
    [41, "$0.41"],
  ])("prints %d cents as %s", (cents, expected) => {
    expect(formatMoney(cents)).toBe(expected);
  });
});

describe("formatCount and formatPercent", () => {
  it("groups thousands and rounds to a whole number", () => {
    expect(formatCount(20)).toBe("20");
    expect(formatCount(26_430)).toBe("26,430");
    expect(formatCount(11.6)).toBe("12");
  });

  it("prints a stored percentage with the share's decimals", () => {
    expect(formatPercent(91.8367)).toBe("92%");
    expect(formatPercent(0.12)).toBe("0.12%");
    expect(formatPercent(0)).toBe("0%");
  });
});

describe("formatFigure", () => {
  it.each([
    [91.8367, "pct", "92%"],
    [860_000, "duration_ms", "14m 20s"],
    [187.3956, "cents", "$1.87"],
    [1_312_500, "tokens", "1.3M"],
    [20, "count", "20"],
  ] as const)("prints %d in %s as %s", (value, unit, expected) => {
    expect(formatFigure(value, unit)).toBe(expected);
  });

  it.each(["pct", "duration_ms", "cents", "tokens", "count"] as const)(
    "prints a dash for a %s figure with nothing to compute it from — never a zero",
    (unit) => {
      expect(formatFigure(null, unit)).toBe(NO_FIGURE);
    },
  );
});

describe("formatDelta", () => {
  it.each([
    [2.8459, "pct", "▲ 3pts"],
    [-1, "pct", "▼ 1pt"],
    [0.4, "pct", "▲ 0.4pts"],
    [-120_000, "duration_ms", "▼ 2m"],
    [-40.6, "cents", "▼ $0.41"],
    [-5, "count", "▼ 5"],
    [250_000, "tokens", "▲ 250k"],
  ] as const)("prints a move of %d %s as %s", (delta, unit, expected) => {
    expect(formatDelta(delta, unit)).toBe(expected);
  });

  it.each([
    [null, "pct"],
    [0, "count"],
    // Smaller than the figure's own print precision: not a move a reader could check.
    [0.04, "pct"],
    [0.3, "cents"],
    [400, "duration_ms"],
    [0.2, "count"],
  ] as const)("states no move for %s %s", (delta, unit) => {
    expect(formatDelta(delta, unit)).toBeNull();
  });
});
