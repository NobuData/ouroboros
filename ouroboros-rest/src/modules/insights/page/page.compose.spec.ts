/**
 * The assembled payload and its honesty gates (BJ.2, #438): what the seeded page reads, what a
 * workspace nothing prices is never told, and which claims have no key until their source exists.
 */

import { insightsResource } from "./page.compose";
import {
  barCards,
  emptyScoreboard,
  keysOf,
  mockupFacts,
  MONEY_KEY,
  unpricedFacts,
} from "./page.fixture";

describe("the insights payload", () => {
  it("is mockup 15: head, five KPIs, three series, five bar cards, the strip, flaky, scoreboard, DORA, freshness", () => {
    const page = insightsResource(mockupFacts());

    expect(Object.keys(page)).toEqual([
      "range",
      "window",
      "repo",
      "usage",
      "head",
      "kpis",
      "series",
      "hbars",
      "performance",
      "flaky",
      "scoreboard",
      "dora",
      "freshness",
    ]);
    expect(page).toMatchObject({
      range: "30d",
      window: { from: "2026-07-10", to: "2026-08-08" },
      repo: "acme-robotics/helios-firmware",
      usage: { pricing: "priced", tokens: 126_000_000, costCents: 18_160 },
      head: { range: "7d", mergedPrs: 27, interventions: 2 },
    });
    expect(page.kpis).toHaveLength(5);
    expect(page.performance).toHaveLength(6);
    expect(page.dora).toHaveLength(4);
    expect(page.flaky.cases).toHaveLength(1);
    expect(page.flaky.cases[0].history).toHaveLength(30);
  });

  it("carries every one of the page's computed sentences", () => {
    const { hbars } = insightsResource(mockupFacts());

    expect([
      hbars.interventions.line,
      hbars.stages.line,
      hbars.suites.line,
      hbars.effort.line,
      hbars.tokens.line,
    ]).toEqual([
      "Fix the top row and interventions drop ~40%.",
      "Implement dominates the loop — the other five stages sum to 8m 20s.",
      "33 failing cases total — 0.12% of everything that ran.",
      "Estimator calibration: 89% of issues land within their predicted band.",
      "≈ 1.3M tokens per merged PR · 31% served by local models.",
    ]);
  });

  it("attaches a methodology to every number: each card, cell, series and bar card", () => {
    const page = insightsResource(mockupFacts());
    const carriers = [
      ...page.kpis,
      ...page.performance,
      ...page.dora,
      page.series.throughput,
      page.series.cost,
      page.series.builds,
      ...barCards(page.hbars),
    ];

    for (const carrier of carriers) {
      expect(carrier.methodology).toMatchObject({
        metricId: expect.any(String) as unknown,
        formula: expect.any(String) as unknown,
        caveats: expect.any(String) as unknown,
        version: expect.any(Number) as unknown,
      });
    }
  });

  it("passes the scoreboard through as BJ.3 answered it", () => {
    const scoreboard = emptyScoreboard();

    expect(insightsResource(mockupFacts({ scoreboard })).scoreboard).toBe(scoreboard);
  });

  it("answers a whole-workspace read with a null repo", () => {
    expect(insightsResource(mockupFacts({ repo: null })).repo).toBeNull();
  });
});

describe("the honesty gates", () => {
  it("gives an unpriced workspace tokens and no dollar figure anywhere in the payload", () => {
    const { scoreboard, ...page } = insightsResource(unpricedFacts());
    const withMoney = keysOf(page).filter((key) => MONEY_KEY.test(key));

    // The scoreboard is BJ.3's payload and applies the same rule in its own vocabulary.
    expect(scoreboard.rows).toEqual([]);
    expect(page.usage).toEqual({
      pricing: "unpriced",
      tokens: 126_000_000,
      unpricedTokens: 126_000_000,
    });
    expect(withMoney).toEqual([]);
    // Tokens are still everywhere a dollar would have been.
    expect(page.kpis[3]).toMatchObject({ key: "cost_per_merged_pr", unit: "tokens" });
    expect(page.performance.at(-1)).toMatchObject({ key: "total_cost", value: null });
    expect(page.series.cost.points.every((point) => point.tokens > 0)).toBe(true);
    // The unit strings say tokens; none says cents.
    expect(page.kpis.map((card) => card.unit)).not.toContain("cents");
  });

  it("keeps the budget guide from a real cap while the alerts claim has no key", () => {
    const { cost } = insightsResource(mockupFacts()).series;

    expect(cost.budget).toMatchObject({ monthlyCapCents: 60_000 });
    expect(keysOf(cost).filter((key) => /alert/i.test(key))).toEqual([]);
  });

  it("has no suggestion slot, no cluster note and no alerts claim until their sources exist", () => {
    const page = insightsResource(mockupFacts());
    const keys = keysOf(page);

    // AB.3 (#209): absent — not empty, not a placeholder.
    expect(page.scoreboard).not.toHaveProperty("suggestion");
    // Mockup 18's analyzer and #237's cap alerts: no key carries either claim.
    expect(keys.filter((key) => /suggest|cluster|analy[sz]|note|alert/i.test(key))).toEqual([]);
    expect(JSON.stringify(page)).not.toMatch(/deps-refresh|analyzer noticed|alerts fire/i);
  });

  it("carries the proxy flags on change failure rate and MTTR, and on nothing measured", () => {
    const { dora } = insightsResource(mockupFacts());

    expect(dora.map((cell) => [cell.key, cell.proxy, cell.methodology.proxy])).toEqual([
      ["deploy_frequency", false, false],
      ["lead_time", false, false],
      ["change_failure_rate", true, true],
      ["mttr", true, true],
    ]);
  });

  it("states the projection's method rather than implying it", () => {
    expect(insightsResource(mockupFacts()).series.cost.projection).toMatchObject({
      method: "linear_to_date",
      daysElapsed: 8,
      daysInMonth: 31,
    });
  });

  it("writes no narrative on the spike: a day and an amount, nothing else", () => {
    expect(insightsResource(mockupFacts()).series.cost.spike).toEqual({
      day: "2026-07-31",
      costCents: 3_140,
    });
  });
});
