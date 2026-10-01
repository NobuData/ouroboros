/**
 * The shapes the windowed metrics service answers with (BJ.1,
 * [#437](https://github.com/NobuData/ouroboros/issues/437)).
 */

import type { MetricAggregation, MetricDefinitionsTable } from "../../db/schema";
import type { Day } from "../rollup/rollup.types";
import type { MetricRange } from "./metrics.window";

/** Who and what a window is about. */
export interface MetricScope {
  /** The workspace, from the tenant context. Every statement filters on it. */
  readonly organizationId: string;
  /** One repository's `owner/name`, or undefined for the whole workspace. */
  readonly repo?: string;
  /**
   * One dimension label (a cause, stage, suite or effort), or undefined for all of them. Required
   * for a dimensioned median: pooling every stage's samples into one median means nothing.
   */
  readonly dimension?: string;
  /** The range. */
  readonly range: MetricRange;
  /** The instant to answer at; the service's clock when omitted. */
  readonly now?: Date;
}

/** The registry entry that travels with every number — decision **I1**'s popover. */
export interface MetricMethodology {
  readonly metricId: string;
  readonly title: string;
  /** How the number is computed, in words. */
  readonly formula: string;
  /** The source planes it is read from. */
  readonly sources: readonly string[];
  readonly caveats: string;
  readonly unit: MetricDefinitionsTable["unit"];
  /** The formula version; bumped on every formula change (V076's guard). */
  readonly version: number;
  /** Whether the metric is a stated proxy for what it is named after. */
  readonly proxy: boolean;
  /** How a window re-derives it. */
  readonly aggregation: MetricAggregation;
}

/** A rate's summed components. */
export interface MetricComponents {
  readonly numerator: number;
  readonly denominator: number;
}

/** One day of a window's series. */
export interface MetricPoint {
  readonly day: Day;
  /** The day's figure, or null when the day has nothing to compute a rate or median from. */
  readonly value: number | null;
  /** Tooltip figures for the day, summed across repositories; never a median's samples. */
  readonly meta: Readonly<Record<string, number>>;
}

/** A metric over a window, with its prior window and methodology. */
export interface MetricWindow {
  readonly metricId: string;
  readonly range: MetricRange;
  /** The window's first and last UTC day. */
  readonly from: Day;
  readonly to: Day;
  /**
   * The window's figure in the metric's unit (a `pct` is 0–100), or null when a rate has no
   * denominator or a median no samples. A `sum` over nothing is 0.
   */
  readonly value: number | null;
  /** A rate's components over the window; absent for sums and medians. */
  readonly components?: MetricComponents;
  /** The prior window's figure, by the same rule. */
  readonly prior: number | null;
  /** The prior window's components, for a rate. */
  readonly priorComponents?: MetricComponents;
  /** `value − prior` (points, for a `pct`), or null when either side is null. */
  readonly delta: number | null;
  /** One point per day of the window, oldest first, today last. */
  readonly series: readonly MetricPoint[];
  readonly methodology: MetricMethodology;
}

/** One stored or live daily row, as the composition reads it. */
export interface DailyRow {
  readonly day: Day;
  readonly metricId: string;
  readonly repoRef: string | null;
  readonly dimension: string;
  readonly value: number;
  readonly numerator: number | null;
  readonly denominator: number | null;
  /** A median's samples, ascending; empty otherwise. */
  readonly samples: readonly number[];
  /** Numeric tooltip figures. */
  readonly meta: Readonly<Record<string, number>>;
}
