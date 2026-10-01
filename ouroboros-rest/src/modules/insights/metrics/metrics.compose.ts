/**
 * Window arithmetic for the windowed metrics service (BJ.1,
 * [#437](https://github.com/NobuData/ouroboros/issues/437)). Kept pure so every rule can be unit
 * tested.
 *
 * **Rates recompose, they never average** (V076's component rule). A window's rate is
 * Σnumerator / Σdenominator over every daily row in it. The mean of the daily rates would weight a
 * day with one closed PR the same as a day with forty, and the result would look plausible while
 * being wrong. Medians pool their days' samples and take one median. Sums add.
 *
 * `cost_per_merged_pr` is never stored per day (V078). It is **derived**: Σ`cost_cents` /
 * Σ`merged_prs` over the same rows, so its numerator and denominator are two stored metrics.
 */

import type { MetricAggregation, MetricDefinitionsTable } from "../../db/schema";
import { median } from "../rollup/rollup.rows";
import type { Day } from "../rollup/rollup.types";
import type { DailyRow, MetricComponents, MetricPoint } from "./metrics.types";

/** How a window computes one metric from daily rows. */
export type MetricPlan =
  | {
      readonly kind: "stored";
      readonly metricId: string;
      readonly aggregation: MetricAggregation;
      /** A ratio's multiplier: 100 for a `pct`, 1 otherwise — what the extractors store. */
      readonly scale: number;
    }
  | {
      readonly kind: "derived";
      /** The stored `sum` metric summed for the numerator. */
      readonly numerator: string;
      /** The stored `sum` metric summed for the denominator. */
      readonly denominator: string;
      readonly scale: number;
    };

/** Metrics a window derives from two stored sums rather than reading their own rows. */
export const DERIVED_RATIOS: Readonly<
  Record<string, { readonly numerator: string; readonly denominator: string }>
> = {
  cost_per_merged_pr: { numerator: "cost_cents", denominator: "merged_prs" },
};

/** One window's figure. */
export interface Composed {
  /** The figure, or null when there is nothing to compute it from. */
  readonly value: number | null;
  /** A rate's components; present exactly for ratio plans. */
  readonly components?: MetricComponents;
}

/**
 * The ratio multiplier for a unit.
 *
 * @param unit - The registry unit.
 * @returns 100 for `pct`, 1 for everything else.
 */
export function unitScale(unit: MetricDefinitionsTable["unit"]): number {
  return unit === "pct" ? 100 : 1;
}

/**
 * Which stored metrics a plan reads.
 *
 * @param plan - The plan.
 * @returns The metric ids whose daily rows the plan composes.
 */
export function planMetrics(plan: MetricPlan): string[] {
  return plan.kind === "stored" ? [plan.metricId] : [plan.numerator, plan.denominator];
}

/**
 * Compose a window's figure from its daily rows.
 *
 * @param plan - How the metric is computed.
 * @param rows - Every daily row inside the window, any metric the plan reads, already scoped.
 * @returns The figure and, for a rate, its components.
 */
export function compose(plan: MetricPlan, rows: readonly DailyRow[]): Composed {
  if (plan.kind === "derived") {
    return ratio(
      sumOf(rows.filter((row) => row.metricId === plan.numerator)),
      sumOf(rows.filter((row) => row.metricId === plan.denominator)),
      plan.scale,
    );
  }

  const own = rows.filter((row) => row.metricId === plan.metricId);

  switch (plan.aggregation) {
    case "sum":
      return { value: sumOf(own) };
    case "ratio":
      return ratio(
        own.reduce((total, row) => total + (row.numerator ?? 0), 0),
        own.reduce((total, row) => total + (row.denominator ?? 0), 0),
        plan.scale,
      );
    case "median": {
      const pooled = own.flatMap((row) => row.samples).sort((a, b) => a - b);

      return { value: pooled.length === 0 ? null : median(pooled) };
    }
  }
}

/**
 * The window's daily series: one point per day, each composed from that day's rows alone.
 *
 * @param plan - How the metric is computed.
 * @param days - The window's days, in order.
 * @param rows - The window's rows.
 * @returns A point per day. A day with no rows is 0 for a sum and null otherwise.
 */
export function seriesOf(
  plan: MetricPlan,
  days: readonly Day[],
  rows: readonly DailyRow[],
): MetricPoint[] {
  const byDay = new Map<Day, DailyRow[]>();

  for (const row of rows) {
    byDay.set(row.day, [...(byDay.get(row.day) ?? []), row]);
  }

  return days.map((day) => {
    const dayRows = byDay.get(day) ?? [];

    return { day, value: compose(plan, dayRows).value, meta: metaOf(dayRows) };
  });
}

/**
 * The difference between a window and its prior.
 *
 * @param value - The window's figure.
 * @param prior - The prior window's.
 * @returns `value − prior`, or null when either is null.
 */
export function deltaOf(value: number | null, prior: number | null): number | null {
  return value === null || prior === null ? null : value - prior;
}

/**
 * A day's tooltip figures, summed across its rows.
 *
 * @param rows - The day's rows.
 * @returns Every numeric `meta` key, summed.
 */
function metaOf(rows: readonly DailyRow[]): Record<string, number> {
  const out: Record<string, number> = {};

  for (const row of rows) {
    for (const [key, value] of Object.entries(row.meta)) {
      out[key] = (out[key] ?? 0) + value;
    }
  }

  return out;
}

/**
 * Sum rows' values.
 *
 * @param rows - The rows.
 * @returns Σvalue; 0 for none.
 */
function sumOf(rows: readonly DailyRow[]): number {
  return rows.reduce((total, row) => total + row.value, 0);
}

/**
 * A rate from its summed components.
 *
 * @param numerator - Σnumerator.
 * @param denominator - Σdenominator.
 * @param scale - The unit's multiplier.
 * @returns The rate and its components; the value is null when the denominator is 0.
 */
function ratio(numerator: number, denominator: number, scale: number): Composed {
  return {
    value: denominator > 0 ? (scale * numerator) / denominator : null,
    components: { numerator, denominator },
  };
}
