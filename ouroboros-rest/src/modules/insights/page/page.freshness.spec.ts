import { NO_FRESHNESS_FACTS, freshnessOf, type FreshnessFacts } from "./page.freshness";

/** The rollup-lag banner's one fact (BK.6, #447): through which day, and when last filled. */

const NOW = new Date("2026-08-08T14:00:00.000Z");
const FILLED_AT = new Date("2026-08-08T13:05:00.000Z");

/**
 * Bookkeeping for a workspace whose families have all filled.
 *
 * @param overrides - What a case changes.
 * @returns The facts.
 */
function facts(overrides: Partial<FreshnessFacts> = {}): FreshnessFacts {
  return {
    families: 3,
    filledFamilies: 3,
    earliestFilledDay: "2026-08-07",
    lastSucceededAt: FILLED_AT,
    failing: false,
    ...overrides,
  };
}

describe("the insights page's freshness", () => {
  it("is current when every family has filled through yesterday", () => {
    expect(freshnessOf(facts(), NOW)).toEqual({
      filledThrough: "2026-08-07",
      lastFilledAt: "2026-08-08T13:05:00.000Z",
      behind: false,
      failing: false,
    });
  });

  it("is behind when a closed day is missing — the stalest family names the day", () => {
    expect(freshnessOf(facts({ earliestFilledDay: "2026-08-06" }), NOW)).toMatchObject({
      filledThrough: "2026-08-06",
      behind: true,
    });
  });

  it("is behind when some families have filled and another never has", () => {
    expect(freshnessOf(facts({ filledFamilies: 2 }), NOW).behind).toBe(true);
  });

  it("passes a failing run through without calling an otherwise current page behind", () => {
    expect(freshnessOf(facts({ failing: true }), NOW)).toMatchObject({
      behind: false,
      failing: true,
    });
  });

  it("is not behind before anything was filled — a cold workspace says so on its cards", () => {
    expect(freshnessOf(NO_FRESHNESS_FACTS, NOW)).toEqual({
      filledThrough: null,
      lastFilledAt: null,
      behind: false,
      failing: false,
    });
  });

  it("judges yesterday by the UTC day, not the local one", () => {
    const justAfterMidnight = new Date("2026-08-09T00:05:00.000Z");

    // Five minutes into Aug 9 UTC, Aug 8 is closed: a page filled through Aug 7 is now behind.
    expect(freshnessOf(facts({ earliestFilledDay: "2026-08-08" }), justAfterMidnight).behind).toBe(
      false,
    );
    expect(freshnessOf(facts(), justAfterMidnight).behind).toBe(true);
  });
});
