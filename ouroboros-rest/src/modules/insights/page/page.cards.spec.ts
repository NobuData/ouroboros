import { doraOf, headOf, kpisOf, moneyOf, performanceOf, trendOf, windowOf } from "./page.cards";
import { pageWindow, mockupWeek, mockupWindows, windowsOf } from "./page.fixture";

describe("the money rule", () => {
  it("carries dollars when any usage was priced, and says what was not", () => {
    expect(moneyOf(126_000_000, 5_000_000, 18_160)).toEqual({
      pricing: "priced",
      tokens: 126_000_000,
      unpricedTokens: 5_000_000,
      costCents: 18_160,
    });
  });

  it("has no dollar key when nothing was priced — unknown is not $0", () => {
    const money = moneyOf(3_000, 3_000, 0);

    expect(money).toEqual({ pricing: "unpriced", tokens: 3_000, unpricedTokens: 3_000 });
    expect(money).not.toHaveProperty("costCents");
  });

  it("keeps a real $0: usage a local model served at no cost is priced", () => {
    expect(moneyOf(3_000, 0, 0)).toMatchObject({ pricing: "priced", costCents: 0 });
  });

  it("is none, with no dollar key, when there was no usage", () => {
    expect(moneyOf(0, 0, 0)).toEqual({ pricing: "none", tokens: 0, unpricedTokens: 0 });
  });
});

describe("trendOf", () => {
  it("judges a move by the metric's polarity", () => {
    expect(trendOf(3, true)).toEqual({ direction: "up", good: true });
    expect(trendOf(-120_000, false)).toEqual({ direction: "down", good: true });
    expect(trendOf(0.2, false)).toEqual({ direction: "up", good: false });
    expect(trendOf(-4, true)).toEqual({ direction: "down", good: false });
  });

  it("passes no judgement on no move or no comparison", () => {
    expect(trendOf(0, true)).toEqual({ direction: "flat", good: null });
    expect(trendOf(null, false)).toEqual({ direction: "flat", good: null });
  });
});

describe("the head", () => {
  it("is the last seven days' merges and interventions", () => {
    expect(headOf(mockupWeek())).toEqual({ range: "7d", mergedPrs: 27, interventions: 2 });
  });

  it("refuses to compose a metric the page did not read", () => {
    expect(() => windowOf(windowsOf(), "merged_prs")).toThrow(/did not read it/);
  });
});

describe("the KPI row", () => {
  const priced = moneyOf(126_000_000, 5_000_000, 18_160);

  it("is mockup 15's five cards, each with its delta, its direction and its popover", () => {
    const row = kpisOf(mockupWindows(), priced);

    expect(row.map((card) => [card.key, card.unit, card.trend.direction, card.trend.good])).toEqual(
      [
        ["autonomous_merge_rate", "pct", "up", true],
        ["merged_untouched_rate", "pct", "up", true],
        ["cycle_time", "duration_ms", "down", true],
        ["cost_per_merged_pr", "cents", "down", true],
        ["human_interventions", "count", "down", true],
      ],
    );
    // 92% ▲ 3pts · 78% · 14m 20s ▼ 2m · $1.87 ▼ $0.41 · 20 ▼ 5
    expect(row.map((card) => Math.round(card.value ?? 0))).toEqual([92, 78, 860_000, 187, 20]);
    expect(Math.round(row[0].delta ?? 0)).toBe(3);
    expect(row[2].delta).toBe(-120_000);
    expect(Math.round(row[3].delta ?? 0)).toBe(-41);
    expect(row[4].delta).toBe(-5);
    expect(row.map((card) => card.methodology.metricId)).toEqual([
      "merge_rate",
      "merged_untouched_rate",
      "cycle_time",
      "cost_per_merged_pr",
      "human_interventions",
    ]);
  });

  it("answers cost per merged PR in tokens, with no dollar figure, when nothing was priced", () => {
    const row = kpisOf(mockupWindows(), moneyOf(126_000_000, 126_000_000, 0));
    const cost = row[3];

    expect(cost).toMatchObject({
      key: "cost_per_merged_pr",
      unit: "tokens",
      methodology: { metricId: "tokens" },
      // More tokens a merge than the prior window: up, and up is not the good way.
      trend: { direction: "up", good: false },
    });
    // 126M over 97 merges, against 140M over 109.
    expect(cost.value).toBeCloseTo(126_000_000 / 97, 6);
    expect(cost.prior).toBeCloseTo(140_000_000 / 109, 6);
  });

  it("answers null — not zero — for a tokens-per-PR with nothing merged", () => {
    const windows = mockupWindows();

    windows.set("merged_prs", pageWindow("merged_prs", { value: 0, prior: 0 }));

    expect(kpisOf(windows, moneyOf(10, 10, 0))[3]).toMatchObject({ value: null, delta: null });
  });
});

describe("the performance strip", () => {
  it("is six cells: builds 412 · 91.5% (377 of 412) · 26 430 cases · pass rate · 126M · total cost", () => {
    const strip = performanceOf(mockupWindows(), moneyOf(126_000_000, 5_000_000, 18_160));

    expect(strip.map((cell) => cell.key)).toEqual([
      "builds",
      "build_success_rate",
      "test_cases_run",
      "test_pass_rate",
      "tokens",
      "total_cost",
    ]);
    expect(strip[0].value).toBe(412);
    expect(strip[1]).toMatchObject({ components: { numerator: 377, denominator: 412 } });
    expect((strip[1].value ?? 0).toFixed(1)).toBe("91.5");
    expect(strip[2].value).toBe(26_430);
    expect(strip[4].value).toBe(126_000_000);
    expect(strip[5]).toMatchObject({ unit: "cents", value: 18_160 });
    expect(strip[5].methodology.metricId).toBe("cost_cents");
  });

  it("has a null total cost — never $0 — when the usage was not priced", () => {
    const strip = performanceOf(mockupWindows(), moneyOf(126_000_000, 126_000_000, 0));

    expect(strip[5].value).toBeNull();
    expect(strip[4].value).toBe(126_000_000);
  });
});

describe("the DORA cells", () => {
  it("are four, with deploy frequency per day and the registry's proxy flags carried through", () => {
    const cells = doraOf(mockupWindows());

    expect(cells.map((cell) => [cell.key, cell.unit, cell.proxy])).toEqual([
      ["deploy_frequency", "per_day", false],
      ["lead_time", "duration_ms", false],
      ["change_failure_rate", "pct", true],
      ["mttr", "duration_ms", true],
    ]);
    // 126 deploys over thirty days, against 108.
    expect(cells[0].value).toBeCloseTo(4.2, 9);
    expect(cells[0].prior).toBeCloseTo(3.6, 9);
    expect(cells[0].trend).toEqual({ direction: "up", good: true });
    expect(cells[1].trend).toEqual({ direction: "down", good: true });
    // Flat is not judged.
    expect(cells[2].trend).toEqual({ direction: "flat", good: null });
    expect(cells[3]).toMatchObject({ value: 1_320_000, delta: -360_000 });
    expect(cells.every((cell) => cell.sparkline.length === 30)).toBe(true);
    expect(cells.map((cell) => cell.methodology.metricId)).toEqual([
      "deploy_frequency",
      "lead_time",
      "change_failure_rate",
      "mttr",
    ]);
  });

  it("follows the registry: a metric it stops calling a proxy stops being flagged", () => {
    const windows = mockupWindows();

    windows.set("mttr", pageWindow("mttr", { value: 1, unit: "duration_ms", proxy: false }));

    expect(doraOf(windows)[3].proxy).toBe(false);
  });
});
