import { describe, expect, it } from "vitest";

import { DEFAULT_RANGE, RANGES, isInsightsRange, parseRange, rangeSearch } from "@/app/insights/range";

/** The insights range (#443): what the address may say, and how a choice is written back. */

describe("parseRange", () => {
  it("reads each range the service answers", () => {
    for (const range of RANGES) expect(parseRange(range)).toBe(range);
  });

  it("reads the default for nothing, for custom, and for anything else", () => {
    expect(DEFAULT_RANGE).toBe("30d");
    expect(parseRange(undefined)).toBe("30d");
    expect(parseRange(null)).toBe("30d");
    expect(parseRange("custom")).toBe("30d");
    expect(parseRange("365d")).toBe("30d");
  });

  it("takes the first of a repeated parameter", () => {
    expect(parseRange(["90d", "7d"])).toBe("90d");
    expect(parseRange([])).toBe("30d");
  });
});

describe("rangeSearch", () => {
  it("writes the default as the bare address, so /insights stays the canonical link", () => {
    expect(rangeSearch("30d")).toBe("");
  });

  it("writes every other range into the address", () => {
    expect(rangeSearch("7d")).toBe("?range=7d");
    expect(rangeSearch("90d")).toBe("?range=90d");
  });

  it("round-trips: what is written is what is read back", () => {
    for (const range of RANGES) {
      expect(parseRange(new URLSearchParams(rangeSearch(range)).get("range"))).toBe(range);
    }
  });
});

describe("isInsightsRange", () => {
  it("accepts the three and nothing else", () => {
    expect(RANGES.every(isInsightsRange)).toBe(true);
    expect(isInsightsRange("custom")).toBe(false);
    expect(isInsightsRange(7)).toBe(false);
  });
});
