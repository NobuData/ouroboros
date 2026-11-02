/**
 * The shapes the windowed metrics service answers with (BJ.1,
 * [#437](https://github.com/NobuData/ouroboros/issues/437)).
 */

import type { DataOrigin, MetricAggregation, MetricDefinitionsTable } from "../../db/schema";
import type { Day } from "../rollup/rollup.types";
import type { OriginFilter } from "./metrics.origin";
import type { DaySpan, MetricRange } from "./metrics.window";

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
  /** Which origins' rows to read (DJ.2); `live` when omitted — see `metrics.origin.ts`. */
  readonly origin?: OriginFilter;
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
  /** How the metric treats data origin, in words (V154, DJ.2). */
  readonly originRule: string;
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

/**
 * What an aggregate was computed over (DJ.2, [#1315](https://github.com/NobuData/ouroboros/issues/1315)):
 * the origin asked for, every origin the window holds, and whether the figure sums more than one.
 */
export interface OriginFacts {
  /** The filter the figure was computed under. */
  readonly origin: OriginFilter;
  /**
   * Every origin with a row in the window, whichever was asked for — `["seeded"]` beside a null
   * live figure is "no live data", not zero.
   */
  readonly originsPresent: readonly DataOrigin[];
  /** True only when `origin` is `all` and the figure sums more than one origin. */
  readonly mixed: boolean;
}

/** A metric over a window, with its prior window and methodology. */
export interface MetricWindow extends OriginFacts {
  readonly metricId: string;
  readonly range: MetricRange;
  /** The window's first and last UTC day. */
  readonly from: Day;
  readonly to: Day;
  /**
   * The window's figure in the metric's unit (a `pct` is 0–100), or null — **no data** — when the
   * origin filter keeps no row in the window, a rate has no denominator or a median no samples.
   * Never zero for want of rows (DJ.2).
   */
  readonly value: number | null;
  /**
   * The count behind the figure: how many source rows (runs, builds, usage rows, test cases) the
   * window's rows were computed from. 0 with a null value is no data; null when a row (a seeded
   * one) did not record it.
   */
  readonly n: number | null;
  /** A rate's components over the window; absent for sums and medians. */
  readonly components?: MetricComponents;
  /** The prior window's figure, by the same rule — no data when the filter kept no prior row. */
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
  /** The origin of the source rows behind it (V154). */
  readonly origin: DataOrigin;
  /** How many source rows are behind it, or null when a seed did not record it. */
  readonly population: number | null;
  readonly value: number;
  readonly numerator: number | null;
  readonly denominator: number | null;
  /** A median's samples, ascending; empty otherwise. */
  readonly samples: readonly number[];
  /** Numeric tooltip figures. */
  readonly meta: Readonly<Record<string, number>>;
}

/** One label of a dimensioned metric, and its window. */
export interface MetricBreakdownEntry {
  /** The label — a cause, stage, suite, effort or task kind. */
  readonly dimension: string;
  readonly window: MetricWindow;
}

/**
 * A dimensioned metric over a range, one window per label (BJ.2,
 * [#438](https://github.com/NobuData/ouroboros/issues/438)) — what a bar card is drawn from.
 */
export interface MetricBreakdown extends OriginFacts {
  readonly metricId: string;
  /** What the labels are. */
  readonly dimensionKind: NonNullable<MetricDefinitionsTable["dimension_kind"]>;
  readonly range: MetricRange;
  readonly from: Day;
  readonly to: Day;
  /**
   * One entry per label with a row of the asked origin in the window **or its prior** — a label
   * that went quiet this window still shows its drop — labels ascending.
   */
  readonly entries: readonly MetricBreakdownEntry[];
  readonly methodology: MetricMethodology;
}

/** What {@link MetricSpan} is asked over: explicit days rather than a named range. */
export interface MetricSpanScope {
  /** The workspace. Every statement filters on it. */
  readonly organizationId: string;
  /** One repository's `owner/name`, or undefined for the whole workspace. */
  readonly repo?: string;
  /** One dimension label; required for a dimensioned median, as on {@link MetricScope}. */
  readonly dimension?: string;
  /** The UTC days, inclusive at both ends. */
  readonly span: DaySpan;
  /** Which origins' rows to read; `live` when omitted, as on {@link MetricScope}. */
  readonly origin?: OriginFilter;
  /** The instant that decides which day is "today" (read live); the service's clock when omitted. */
  readonly now?: Date;
}

/**
 * One metric over an explicit span of days — the same composition as a {@link MetricWindow},
 * without the comparison to a prior window, and with what the figure rests on
 * ([#619](https://github.com/NobuData/ouroboros/issues/619), the telemetry research tool).
 */
export interface MetricSpan {
  readonly metricId: string;
  /** The span's first and last UTC day. */
  readonly from: Day;
  readonly to: Day;
  /** The figure, as {@link MetricWindow.value} computes it for the same days. */
  readonly value: number | null;
  /** A rate's numerator and denominator; present exactly for ratio metrics. */
  readonly components?: MetricComponents;
  /** A median metric's pooled samples, ascending; empty for a sum or a rate. */
  readonly samples: readonly number[];
  /**
   * How many days of the span have any row of the asked origin for the metric. Zero means nothing
   * was recorded, and the value is then null.
   */
  readonly days: number;
  /** Every origin with a row in the span, whichever was asked for (DJ.2). */
  readonly originsPresent: readonly DataOrigin[];
  readonly methodology: MetricMethodology;
}
