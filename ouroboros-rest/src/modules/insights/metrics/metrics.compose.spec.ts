import {
  compose,
  deltaOf,
  planMetrics,
  seriesOf,
  unitScale,
  type MetricPlan,
} from "./metrics.compose";
import type { DailyRow } from "./metrics.types";

/**
 * Window arithmetic (BJ.1, #437). The central claim is that rates recompose exactly: a window's
 * rate is Σnumerator / Σdenominator, never the mean of its days' rates.
 */

/**
 * A daily row with defaults.
 *
 * @param overrides - What the test cares about.
 * @returns The row.
 */
function row(overrides: Partial<DailyRow>): DailyRow {
  return {
    day: "2026-08-01",
    metricId: "merge_rate",
    repoRef: "acme/helios",
    dimension: "",
    value: 0,
    numerator: null,
    denominator: null,
    samples: [],
    meta: {},
    ...overrides,
  };
}

/**
 * A ratio row whose value is its own day's rate, as the extractors store it.
 *
 * @param day - The day.
 * @param numerator - The day's numerator.
 * @param denominator - The day's denominator.
 * @returns The row.
 */
function ratioDay(day: string, numerator: number, denominator: number): DailyRow {
  return row({ day, value: (100 * numerator) / denominator, numerator, denominator });
}

const MERGE_RATE: MetricPlan = {
  kind: "stored",
  metricId: "merge_rate",
  aggregation: "ratio",
  scale: 100,
};

describe("metrics window composition", () => {
  describe("rate recomposition", () => {
    it("sums components rather than averaging daily rates, which here differ visibly", () => {
      // Day one: 1 of 1 closed merged (100%). Day two: 10 of 40 (25%).
      // Average of daily rates: 62.5%. The true window rate: 11 of 41 = 26.83%.
      const rows = [ratioDay("2026-08-01", 1, 1), ratioDay("2026-08-02", 10, 40)];
      const averaged = rows.reduce((total, r) => total + r.value, 0) / rows.length;

      const composed = compose(MERGE_RATE, rows);

      expect(averaged).toBe(62.5);
      expect(composed.components).toEqual({ numerator: 11, denominator: 41 });
      expect(composed.value).toBeCloseTo((100 * 11) / 41, 12);
      expect(composed.value).not.toBeCloseTo(averaged, 0);
    });

    it("sums across repositories and dimensions too", () => {
      const rows = [
        ratioDay("2026-08-01", 3, 4),
        { ...ratioDay("2026-08-01", 1, 6), repoRef: "acme/zephyr" },
      ];

      expect(compose(MERGE_RATE, rows)).toEqual({
        value: 40,
        components: { numerator: 4, denominator: 10 },
      });
    });

    it("answers null with zero components when nothing closed", () => {
      expect(compose(MERGE_RATE, [])).toEqual({
        value: null,
        components: { numerator: 0, denominator: 0 },
      });
    });

    it("keeps a non-percentage ratio in its own unit", () => {
      const leadTime: MetricPlan = {
        kind: "stored",
        metricId: "lead_time",
        aggregation: "ratio",
        scale: 1,
      };
      const rows = [
        row({ metricId: "lead_time", value: 1000, numerator: 3000, denominator: 3 }),
        row({ metricId: "lead_time", value: 9000, numerator: 9000, denominator: 1 }),
      ];

      expect(compose(leadTime, rows).value).toBe(3000);
    });
  });

  describe("medians", () => {
    const CYCLE: MetricPlan = {
      kind: "stored",
      metricId: "cycle_time",
      aggregation: "median",
      scale: 1,
    };

    it("pools every day's samples and takes one median, never a median of medians", () => {
      // Daily medians are 1 and 100 (and their mean 50.5); the pooled median is 10.
      const rows = [
        row({ metricId: "cycle_time", day: "2026-08-01", value: 1, samples: [1] }),
        row({ metricId: "cycle_time", day: "2026-08-02", value: 100, samples: [10, 100, 200] }),
      ];

      expect(compose(CYCLE, rows).value).toBe(55);
      expect(compose(CYCLE, [...rows, row({ metricId: "cycle_time", samples: [5] })]).value).toBe(
        10,
      );
    });

    it("answers null with no samples, and carries no components", () => {
      expect(compose(CYCLE, [])).toEqual({ value: null });
    });
  });

  describe("sums", () => {
    const MERGED: MetricPlan = {
      kind: "stored",
      metricId: "merged_prs",
      aggregation: "sum",
      scale: 1,
    };

    it("adds values, and a sum of nothing is zero", () => {
      const rows = [
        row({ metricId: "merged_prs", value: 4 }),
        row({ metricId: "merged_prs", value: 6 }),
      ];

      expect(compose(MERGED, rows)).toEqual({ value: 10 });
      expect(compose(MERGED, [])).toEqual({ value: 0 });
    });

    it("ignores rows of other metrics", () => {
      expect(compose(MERGED, [row({ metricId: "cost_cents", value: 999 })])).toEqual({ value: 0 });
    });
  });

  describe("derived ratios", () => {
    const COST_PER_PR: MetricPlan = {
      kind: "derived",
      numerator: "cost_cents",
      denominator: "merged_prs",
      scale: 1,
    };

    it("divides one stored sum by another over the whole window", () => {
      // Day one spends with no merge; a per-day ratio could not hold it, the window can.
      const rows = [
        row({ metricId: "cost_cents", day: "2026-08-01", value: 300 }),
        row({ metricId: "cost_cents", day: "2026-08-02", value: 260 }),
        row({ metricId: "merged_prs", day: "2026-08-02", value: 3 }),
      ];

      expect(compose(COST_PER_PR, rows)).toEqual({
        value: 560 / 3,
        components: { numerator: 560, denominator: 3 },
      });
    });

    it("reads both stored metrics", () => {
      expect(planMetrics(COST_PER_PR)).toEqual(["cost_cents", "merged_prs"]);
      expect(planMetrics(MERGE_RATE)).toEqual(["merge_rate"]);
    });
  });

  describe("series", () => {
    it("has one point per day, each composed from that day alone, with summed meta", () => {
      const rows = [
        { ...ratioDay("2026-08-01", 1, 2), meta: { interventions: 1 } },
        { ...ratioDay("2026-08-01", 1, 2), repoRef: "acme/zephyr", meta: { interventions: 2 } },
        ratioDay("2026-08-03", 3, 3),
      ];

      expect(seriesOf(MERGE_RATE, ["2026-08-01", "2026-08-02", "2026-08-03"], rows)).toEqual([
        { day: "2026-08-01", value: 50, meta: { interventions: 3 } },
        { day: "2026-08-02", value: null, meta: {} },
        { day: "2026-08-03", value: 100, meta: {} },
      ]);
    });

    it("draws a day with no rows as zero for a sum", () => {
      const merged: MetricPlan = {
        kind: "stored",
        metricId: "merged_prs",
        aggregation: "sum",
        scale: 1,
      };

      expect(seriesOf(merged, ["2026-08-01"], [])).toEqual([
        { day: "2026-08-01", value: 0, meta: {} },
      ]);
    });
  });

  it("takes a delta only when both sides exist", () => {
    expect(deltaOf(92, 89)).toBe(3);
    expect(deltaOf(null, 89)).toBeNull();
    expect(deltaOf(92, null)).toBeNull();
  });

  it("scales percentages to 0–100 and leaves other units alone", () => {
    expect(unitScale("pct")).toBe(100);
    expect(unitScale("duration_ms")).toBe(1);
    expect(unitScale("cents")).toBe(1);
  });
});
