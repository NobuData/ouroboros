import { spendLine, spendRollup, VERIFICATION_TASK_KIND, withinCap } from "./page.spend";
import { totals } from "./page.store.fixture";

/**
 * The Spend card's rollup (AX.5, [#361](https://github.com/NobuData/ouroboros/issues/361), decision
 * **V8**) — a grouping of the run's ledger under the route cap, and pricing honesty: an unpriced
 * ledger is a `null` cost, never `$0`.
 */

const CAP = { tag: "implement-primary", maxCostCentsPerRun: 250 };

describe("spendRollup", () => {
  it("reproduces mockup 12's card — 284k · $1.52, 41k · $0.19, within $2.50", () => {
    expect(spendRollup(totals(284_000, "152.0000"), totals(41_000, "19.0000"), CAP)).toEqual({
      loop: {
        tokens: 284_000,
        tokensIn: 227_200,
        tokensOut: 56_800,
        costCents: "152.0000",
        unpricedEvents: 0,
      },
      verification: {
        tokens: 41_000,
        tokensIn: 32_800,
        tokensOut: 8_200,
        costCents: "19.0000",
        unpricedEvents: 0,
      },
      verificationTag: VERIFICATION_TASK_KIND,
      cap: { cents: 250, routeTag: "implement-primary" },
      withinCap: true,
    });
  });

  it("never produces $0 from missing rates — an unpriced ledger is token counts and a null cost", () => {
    const rollup = spendRollup(totals(284_000, null, 6), totals(41_000, null, 1), CAP);

    expect(rollup.loop).toMatchObject({ tokens: 284_000, costCents: null, unpricedEvents: 6 });
    expect(rollup.verification).toMatchObject({ tokens: 41_000, costCents: null });
    expect(rollup.loop.costCents).not.toBe("0");
    expect(rollup.verification.costCents).not.toBe("0");
    // And the cap line does not claim to know either.
    expect(rollup.withinCap).toBeNull();
  });

  it("has no cap line for a route without one, or no route at all", () => {
    expect(spendRollup(totals(10, "1"), totals(0, null), undefined)).toMatchObject({
      cap: null,
      withinCap: null,
    });
    expect(
      spendRollup(totals(10, "1"), totals(0, null), { tag: "open", maxCostCentsPerRun: null }),
    ).toMatchObject({ cap: null, withinCap: null });
  });

  it("keeps an empty verification slice honest too — no rows is no cost, not a free one", () => {
    expect(spendRollup(totals(284_000, "152.0000"), totals(0, null), CAP).verification).toEqual({
      tokens: 0,
      tokensIn: 0,
      tokensOut: 0,
      costCents: null,
      unpricedEvents: 0,
    });
  });
});

describe("withinCap", () => {
  const line = (costCents: string | null, unpricedEvents = 0) =>
    spendLine({ tokensIn: 1, tokensOut: 1, costCents, unpricedEvents });

  it.each([
    ["nothing priced", line(null), 250, null],
    ["no cap", line("100"), null, null],
    ["over, fully priced", line("251"), 250, false],
    ["over even as a lower bound", line("300", 2), 250, false],
    ["exactly at the cap", line("250"), 250, true],
    ["under, fully priced", line("152.0000"), 250, true],
    ["under, but only a lower bound", line("152", 1), 250, null],
  ])("%s", (_name, loop, cap, expected) => {
    expect(withinCap(loop, cap)).toBe(expected);
  });
});
