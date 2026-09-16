import {
  MINUTES_PER_DAY,
  batchSummary,
  formatDollars,
  rateOf,
  type SummaryDraft,
} from "./planning.summary";

/**
 * The footer (AL.4, #280; decision N10). Two acceptance criteria live here: loop time comes from
 * **real summed `est_minutes`**, and the summary **omits `$` entirely** when no priced rate exists —
 * never `$0`.
 */

/**
 * One draft.
 *
 * @param overrides - What differs.
 * @returns The draft.
 */
function draft(overrides: Partial<SummaryDraft> = {}): SummaryDraft {
  return {
    selected: true,
    estimate: { estMinutes: 540, estTokens: 1_000_000, estimator: "heuristic-v0" },
    price: { billingMode: "token", inputCentsPer1m: "300" },
    ...overrides,
  };
}

describe("batchSummary", () => {
  it("sums real est_minutes over the selected, sized drafts, as days of loop time", () => {
    const summary = batchSummary([
      draft({ estimate: { estMinutes: 1440, estTokens: 0, estimator: "heuristic-v0" } }),
      draft({ estimate: { estMinutes: 3024, estTokens: 0, estimator: "heuristic-v0" } }),
      // Unselected: not in the push, so not in the footer.
      draft({ selected: false, estimate: { estMinutes: 9999, estTokens: 0, estimator: "x-v1" } }),
      // Unsized: contributes nothing and is visible as sizedCount < selectedCount.
      draft({ estimate: null }),
    ]);

    expect(summary.estMinutes).toBe(4464);
    expect(summary.loopDays).toBe(Math.round((4464 / MINUTES_PER_DAY) * 10) / 10);
    expect(summary.loopDays).toBe(3.1);
    expect(summary).toMatchObject({
      draftCount: 4,
      selectedCount: 3,
      sizedCount: 2,
      allSized: false,
      estimators: ["heuristic-v0"],
    });
  });

  it("says all sized only when every selected draft has an estimate, and there is one", () => {
    expect(batchSummary([draft(), draft({ selected: false, estimate: null })]).allSized).toBe(true);
    expect(batchSummary([draft({ selected: false })]).allSized).toBe(false);
    expect(batchSummary([]).allSized).toBe(false);
  });

  it("omits spend entirely — not $0 — when no rate prices anything", () => {
    const summary = batchSummary([
      draft({ price: null }),
      draft({ price: { billingMode: "seat", inputCentsPer1m: null } }),
      draft({ price: { billingMode: "usage", inputCentsPer1m: null } }),
    ]);

    expect(summary).not.toHaveProperty("spend");
    expect(JSON.stringify(summary)).not.toContain("$");
  });

  it("prices est_tokens at the input rate when a token price exists", () => {
    // 2M tokens at 300¢/1M, twice = 1200¢.
    const summary = batchSummary([
      draft({ estimate: { estMinutes: 60, estTokens: 2_000_000, estimator: "heuristic-v0" } }),
      draft({ estimate: { estMinutes: 60, estTokens: 2_000_000, estimator: "heuristic-v0" } }),
    ]);

    expect(summary.spend).toEqual({ cents: 1200, display: "$12", partial: false });
  });

  it("marks a subtotal partial when some sized drafts are unpriced", () => {
    const summary = batchSummary([draft(), draft({ price: null })]);

    expect(summary.spend).toEqual({ cents: 300, display: "$3.00", partial: true });
  });

  it("counts a free model as priced — a real zero, not an unknown", () => {
    const summary = batchSummary([
      draft({ price: { billingMode: "free", inputCentsPer1m: null } }),
    ]);

    expect(summary.spend).toEqual({ cents: 0, display: "$0.00", partial: false });
  });

  it("does not price unselected or unsized drafts", () => {
    const summary = batchSummary([draft({ selected: false }), draft({ estimate: null })]);

    expect(summary).not.toHaveProperty("spend");
  });
});

describe("rateOf", () => {
  it.each([
    [null, undefined],
    [{ billingMode: "token", inputCentsPer1m: "250.5" }, 250.5],
    [{ billingMode: "token", inputCentsPer1m: null }, undefined],
    [{ billingMode: "token", inputCentsPer1m: "not a number" }, undefined],
    [{ billingMode: "free", inputCentsPer1m: null }, 0],
    [{ billingMode: "seat", inputCentsPer1m: null }, undefined],
    [{ billingMode: "usage", inputCentsPer1m: null }, undefined],
  ] as const)("reads %j as %s", (price, expected) => {
    expect(rateOf(price)).toBe(expected);
  });
});

describe("formatDollars", () => {
  it.each([
    [1400, "$14"],
    [1000, "$10"],
    [999, "$9.99"],
    [36, "$0.36"],
    [0, "$0.00"],
  ])("prints %i cents as %s", (cents, expected) => {
    expect(formatDollars(cents)).toBe(expected);
  });
});
