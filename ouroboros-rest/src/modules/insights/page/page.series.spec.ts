import { moneyOf } from "./page.cards";
import { DAYS, pageWindow, mockupWindows, quarterWith, TODAY, unpricedFacts } from "./page.fixture";
import {
  budgetOf,
  daysInMonth,
  projectionOf,
  seriesOf,
  SPIKE_FACTOR,
  spikeOf,
} from "./page.series";

const PRICED = moneyOf(126_000_000, 5_000_000, 18_160);
const CAPS = { monthlyCapCents: 60_000, connections: 2 };

describe("the throughput chart", () => {
  it("ends at six, and its tooltip is the same day's merges, spend and interventions", () => {
    const { throughput } = seriesOf(mockupWindows(), quarterWith(), CAPS, PRICED);

    expect(throughput.points).toHaveLength(30);
    expect(throughput.points.at(-1)).toMatchObject({ day: TODAY, mergedPrs: 6 });
    // `Aug 4 — 6 merged · $9.12 · 1 intervention`
    expect(throughput.points[25]).toEqual({
      day: "2026-08-04",
      mergedPrs: 6,
      interventions: 1,
      costCents: 912,
    });
    expect(throughput.methodology.metricId).toBe("merged_prs");
  });

  it("omits a day's spend when that day's usage was not priced", () => {
    const windows = mockupWindows();
    const everyDay = DAYS.map(() => 4_200_000);

    // Aug 4: every token unpriced.
    windows.set(
      "unpriced_tokens",
      pageWindow("unpriced_tokens", {
        unit: "tokens",
        series: everyDay.map((tokens, index) => (index === 25 ? tokens : 150_000)),
      }),
    );

    const { throughput, cost } = seriesOf(windows, quarterWith(), CAPS, PRICED);

    expect(throughput.points[25]).toEqual({ day: "2026-08-04", mergedPrs: 6, interventions: 1 });
    expect(cost.points[25]).toEqual({ day: "2026-08-04", tokens: 4_200_000 });
    expect(throughput.points[24]).toHaveProperty("costCents", 500);
  });
});

describe("the cost chart", () => {
  it("carries the endpoint, the spike eight days back, the real-cap guide and a stated projection", () => {
    const { cost } = seriesOf(mockupWindows(), quarterWith(), CAPS, PRICED);

    expect(cost.points.at(-1)).toEqual({ day: TODAY, tokens: 4_200_000, costCents: 1_860 });
    // `$31.40` — a plain value, with no story attached.
    expect(cost.spike).toEqual({ day: "2026-07-31", costCents: 3_140 });
    // $600 over August's 31 days.
    expect(cost.budget).toEqual({ monthlyCapCents: 60_000, dailyCents: 1_935, connections: 2 });
    expect(cost.projection).toEqual({
      method: "linear_to_date",
      monthToDateCents: 5_772,
      projectedCents: 22_367,
      daysElapsed: 8,
      daysInMonth: 31,
    });
    expect(cost.methodology.metricId).toBe("cost_cents");
  });

  it("has no key for the alerts claim: nothing fires an alert until cap alerts exist (#237)", () => {
    const { cost } = seriesOf(mockupWindows(), quarterWith(), CAPS, PRICED);

    expect(Object.keys(cost).sort()).toEqual([
      "budget",
      "methodology",
      "points",
      "projection",
      "spike",
    ]);
    expect(JSON.stringify(cost)).not.toMatch(/alert/i);
  });

  it("drops the guide — and keeps everything else — when no connection has a cap", () => {
    const uncapped = { monthlyCapCents: null, connections: 0 };
    const { cost } = seriesOf(mockupWindows(), quarterWith(), uncapped, PRICED);

    expect(cost).not.toHaveProperty("budget");
    expect(cost).toHaveProperty("projection");
    expect(cost).toHaveProperty("spike");
  });

  it("is tokens only for a workspace nothing prices: no guide, no projection, no spike, no dollars", () => {
    const facts = unpricedFacts();
    const { cost, throughput } = seriesOf(
      facts.windows,
      facts.quarter,
      CAPS,
      moneyOf(126_000_000, 126_000_000, 0),
    );

    expect(Object.keys(cost).sort()).toEqual(["methodology", "points"]);
    expect(cost.points.every((point) => !("costCents" in point) && point.tokens > 0)).toBe(true);
    expect(throughput.points.every((point) => !("costCents" in point))).toBe(true);
  });
});

describe("budgetOf", () => {
  it("spreads the cap over the days of the window's month", () => {
    expect(budgetOf({ monthlyCapCents: 60_000, connections: 1 }, "2026-09-10")?.dailyCents).toBe(
      2_000,
    );
    expect(budgetOf({ monthlyCapCents: 60_000, connections: 1 }, "2026-02-10")?.dailyCents).toBe(
      2_143,
    );
  });

  it("is absent with no cap, and for a cap of zero", () => {
    expect(budgetOf({ monthlyCapCents: null, connections: 0 }, TODAY)).toBeUndefined();
    expect(budgetOf({ monthlyCapCents: 0, connections: 1 }, TODAY)).toBeUndefined();
  });

  it("knows a leap February", () => {
    expect([
      daysInMonth("2028-02-10"),
      daysInMonth("2026-02-10"),
      daysInMonth("2026-12-31"),
    ]).toEqual([29, 28, 31]);
  });
});

describe("projectionOf", () => {
  it("moves with the month's spend — it is computed, not typed", () => {
    const light = projectionOf(quarterWith([100, 100, 100, 100, 100, 100, 100, 100]), TODAY);
    const heavy = projectionOf(quarterWith([900, 900, 900, 900, 900, 900, 900, 900]), TODAY);

    expect(light).toMatchObject({ monthToDateCents: 800, projectedCents: 3_100 });
    expect(heavy).toMatchObject({ monthToDateCents: 7_200, projectedCents: 27_900 });
  });

  it("is absent when nothing was priced this month", () => {
    expect(projectionOf(unpricedFacts().quarter, TODAY)).toBeUndefined();
  });
});

describe("spikeOf", () => {
  const points = (cents: readonly (number | undefined)[]) =>
    cents.map((costCents, index) => ({
      day: DAYS[index],
      tokens: 1,
      ...(costCents === undefined ? {} : { costCents }),
    }));

  it("marks the highest day when it is at least the factor above the median day", () => {
    expect(spikeOf(points([500, 500, 500, 500, 500 * SPIKE_FACTOR]))).toEqual({
      day: DAYS[4],
      costCents: 1_000,
    });
  });

  it("marks nothing in an even month, in a short one, or among unpriced days", () => {
    expect(spikeOf(points([500, 520, 480, 510, 990]))).toBeUndefined();
    expect(spikeOf(points([500, 500, 500, 5_000]))).toBeUndefined();
    expect(spikeOf(points([undefined, undefined, 500, 500, 500, 5_000]))).toBeUndefined();
    expect(spikeOf(points([0, 0, 0, 0, 0, 0]))).toBeUndefined();
  });
});

describe("the builds chart", () => {
  it("stacks each day's successes and failures, and has no cluster note to carry", () => {
    const { builds } = seriesOf(mockupWindows(), quarterWith(), CAPS, PRICED);

    // The mockup's `18 · 2 failed` day.
    expect(builds.points[28]).toEqual({ day: "2026-08-07", succeeded: 16, failed: 2 });
    expect(builds.points[0]).toEqual({ day: DAYS[0], succeeded: 13, failed: 1 });
    // No analyzer source exists (mockup 18), so there is no key for its note.
    expect(Object.keys(builds).sort()).toEqual(["methodology", "points"]);
  });
});
