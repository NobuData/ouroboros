/**
 * `GET /api/v1/insights` — the payload mockup 15 is drawn from, exactly as `openapi.yaml`'s
 * `Insights*` schemas promise it (BJ.2, [#438](https://github.com/NobuData/ouroboros/issues/438)).
 *
 * ```
 * head          this week's merges and interventions — the composed sentence's data
 * kpis[5]       value · prior · delta · trend · methodology
 * series        throughput (+ tooltip meta) · cost (+ budget, projection, spike) · builds
 * hbars         interventions · stages · suites · effort · tokens — rows and a computed line
 * performance   the build & test strip
 * flaky         states, rates and history from real occurrences
 * scoreboard    BJ.3's payload, as it answers it
 * dora[4]       value · delta · sparkline · proxy flag
 * freshness     through which day the rollups run, and when they were last filled
 * ```
 *
 * Three rules shape every type here:
 *
 *   * **A value is a number; a line is a sentence.** The UI formats values. Insight lines are
 *     computed on the server and travel as strings, so a client cannot ship one as a literal.
 *   * **Money is present or absent, never zero-by-default** (decision **I8**). A figure that needs
 *     priced usage carries `costCents` only when the usage it covers was priced; otherwise the key
 *     is not in the object and the tokens beside it are the whole answer.
 *   * **A gated claim is a missing key.** Cap alerts (#237), the routing suggestion (#209) and the
 *     analyzer's cluster note (mockup 18) have no key here until their source exists — not a
 *     `false`, not an empty string, nothing a client could render by accident.
 */

import type { FlakeCardState } from "../../flakes/flakes.resources";
import type { Day } from "../rollup/rollup.types";
import type { MetricMethodology } from "../metrics/metrics.types";
import type { MetricRange } from "../metrics/metrics.window";
import type { Scoreboard } from "../scoreboard/scoreboard.types";

/** Whether the usage a figure covers was priced. */
export type InsightsPricing =
  /** Some of it was: dollar figures are the priced part, and `unpricedTokens` says what is not. */
  | "priced"
  /** None of it was: there are tokens, and no dollar key anywhere. */
  | "unpriced"
  /** There was no usage at all. */
  | "none";

/** Tokens, and the dollars they cost when priced. */
export interface InsightsMoney {
  readonly pricing: InsightsPricing;
  /** Every token, priced or not. */
  readonly tokens: number;
  /** The part of {@link tokens} no price covers. */
  readonly unpricedTokens: number;
  /** Priced spend in cents. **Absent** unless `pricing` is `priced`. */
  readonly costCents?: number;
}

/** Which way a figure moved against the prior window, and whether that is the good way. */
export interface InsightsTrend {
  readonly direction: "up" | "down" | "flat";
  /** True when the move is an improvement, false when it is not; null when flat or unknown. */
  readonly good: boolean | null;
}

/** The page head: the numbers behind *"27 PRs merged this week. 2 needed a human."* */
export interface InsightsHead {
  /** The head is always the last seven days, whatever range the page shows. */
  readonly range: "7d";
  readonly mergedPrs: number;
  readonly interventions: number;
}

/** One KPI card's place in the row. */
export type InsightsKpiKey =
  | "autonomous_merge_rate"
  | "merged_untouched_rate"
  | "cycle_time"
  | "cost_per_merged_pr"
  | "human_interventions";

/** One KPI card. */
export interface InsightsKpi {
  readonly key: InsightsKpiKey;
  /** `pct`, `duration_ms`, `cents`, `tokens` or `count` — what `value` is in. */
  readonly unit: MetricMethodology["unit"];
  /** The figure, or null when the window has nothing to compute it from. */
  readonly value: number | null;
  /** The prior window's figure. */
  readonly prior: number | null;
  /** `value − prior`, in `unit` (points for a `pct`). */
  readonly delta: number | null;
  readonly trend: InsightsTrend;
  /** The registry entry behind the number — the card's popover. */
  readonly methodology: MetricMethodology;
}

/** One day of the throughput chart, with what its crosshair tooltip prints. */
export interface InsightsThroughputPoint {
  readonly day: Day;
  readonly mergedPrs: number;
  readonly interventions: number;
  /** The day's priced spend. **Absent** on a day with no priced usage. */
  readonly costCents?: number;
}

/** One day of the cost chart. */
export interface InsightsCostPoint {
  readonly day: Day;
  /** Every token that day. */
  readonly tokens: number;
  /** The day's priced spend. **Absent** on a day with no priced usage. */
  readonly costCents?: number;
}

/** The dashed guide across the cost chart, from the workspace's real provider caps. */
export interface InsightsBudget {
  /** The monthly caps of every enabled provider connection that has one, summed. */
  readonly monthlyCapCents: number;
  /** {@link monthlyCapCents} over the days in the current UTC month — the guide's height. */
  readonly dailyCents: number;
  /** How many connections the cap is the sum of. */
  readonly connections: number;
}

/** The month's projected spend, and how it was projected. */
export interface InsightsProjection {
  /** Stated, not implied (decision I8): spend so far this month ÷ days elapsed × days in month. */
  readonly method: "linear_to_date";
  readonly monthToDateCents: number;
  readonly projectedCents: number;
  /** Days of the UTC month so far, today included. */
  readonly daysElapsed: number;
  readonly daysInMonth: number;
}

/** The cost chart's one annotated day — a plain value: nothing attributes it to a cause. */
export interface InsightsCostSpike {
  readonly day: Day;
  readonly costCents: number;
}

/** The cost chart. */
export interface InsightsCostSeries {
  readonly points: readonly InsightsCostPoint[];
  /** **Absent** when no enabled connection has a cap, or the workspace has no priced usage. */
  readonly budget?: InsightsBudget;
  /** **Absent** when the workspace has no priced usage this month. */
  readonly projection?: InsightsProjection;
  /** **Absent** unless one day stands well above the window's ordinary days. */
  readonly spike?: InsightsCostSpike;
  readonly methodology: MetricMethodology;
}

/** One day of the stacked build bars. */
export interface InsightsBuildsPoint {
  readonly day: Day;
  readonly succeeded: number;
  readonly failed: number;
}

/** The page's three time series. */
export interface InsightsSeries {
  readonly throughput: {
    readonly points: readonly InsightsThroughputPoint[];
    readonly methodology: MetricMethodology;
  };
  readonly cost: InsightsCostSeries;
  readonly builds: {
    readonly points: readonly InsightsBuildsPoint[];
    readonly methodology: MetricMethodology;
  };
}

/** One bar. */
export interface InsightsBar {
  /** The dimension's stored label — a cause id, a stage key, a suite name, an effort, a task kind. */
  readonly key: string;
  /** What the bar is called on the card. */
  readonly label: string;
  /** In the card's `unit`. */
  readonly value: number;
}

/** One horizontal-bar card. */
export interface InsightsBarCard {
  readonly unit: MetricMethodology["unit"];
  /** The card's total where its bars add up to one (counts and tokens); null for medians. */
  readonly total: number | null;
  /** The bars, in the card's order. Empty when the window has none. */
  readonly bars: readonly InsightsBar[];
  /**
   * The card's insight line — a sentence **computed** from the bars, or null when the window
   * gives it nothing true to say.
   */
  readonly line: string | null;
  readonly methodology: MetricMethodology;
}

/** The five bar cards. */
export interface InsightsBarCards {
  readonly interventions: InsightsBarCard;
  readonly stages: InsightsBarCard;
  readonly suites: InsightsBarCard;
  readonly effort: InsightsBarCard;
  readonly tokens: InsightsBarCard;
}

/** One cell of the build & test performance strip. */
export interface InsightsPerformanceCell {
  readonly key:
    "builds" | "build_success_rate" | "test_cases_run" | "test_pass_rate" | "tokens" | "total_cost";
  readonly unit: MetricMethodology["unit"];
  /** The figure; null when there is nothing to compute it from — or, for `total_cost`, no price. */
  readonly value: number | null;
  /** A rate's parts — `377 ✓ / 35 ✗` is `numerator` and `denominator − numerator`. */
  readonly components?: { readonly numerator: number; readonly denominator: number };
  readonly methodology: MetricMethodology;
}

/** One day of a flaky case's history. */
export interface InsightsFlakyPoint {
  readonly day: Day;
  /** Flaky occurrences over observed ones that day, 0–100; null on a day the case did not run. */
  readonly ratePct: number | null;
}

/** One row of the flaky card. */
export interface InsightsFlakyCase {
  readonly caseKey: string;
  readonly name: string | null;
  readonly suite: string | null;
  readonly repository: string;
  readonly state: FlakeCardState;
  /** Flaky occurrences over observed ones in the window, 0–100; null when it did not run. */
  readonly ratePct: number | null;
  /** The second half of the window's rate against the first half's. */
  readonly trend: "rising" | "falling" | "flat";
  readonly history: readonly InsightsFlakyPoint[];
  /** The one platform every flaky occurrence ran on — **absent** when none or several. */
  readonly platform?: string;
  /** The loop that showed a `fixed` case had stopped flaking — **absent** when none names one. */
  readonly resolvedBy?: { readonly runId: string; readonly issueNumber: number };
}

/** The flaky card. */
export interface InsightsFlaky {
  readonly cases: readonly InsightsFlakyCase[];
}

/** One DORA cell. */
export interface InsightsDoraCell {
  readonly key: "deploy_frequency" | "lead_time" | "change_failure_rate" | "mttr";
  /** `per_day` for deploy frequency; otherwise the metric's own unit. */
  readonly unit: MetricMethodology["unit"] | "per_day";
  readonly value: number | null;
  readonly prior: number | null;
  readonly delta: number | null;
  readonly trend: InsightsTrend;
  /** One value per day of the window, oldest first — the cell's sparkline. */
  readonly sparkline: readonly (number | null)[];
  /** True when the metric is a stated stand-in for what it is named after — the registry's flag. */
  readonly proxy: boolean;
  readonly methodology: MetricMethodology;
}

/**
 * How current the rollups behind the page are (BK.6, #447) — what the rollup-lag banner says.
 * `filledThrough` is the stalest family's last complete day; `lastFilledAt` the latest successful
 * fill. Both are null before anything was filled — a cold workspace, which is not `behind`.
 */
export interface InsightsFreshness {
  readonly filledThrough: Day | null;
  /** ISO 8601. */
  readonly lastFilledAt: string | null;
  /** A day the hourly job should have closed is missing, or a family has never filled. */
  readonly behind: boolean;
  /** Some family's latest run failed. */
  readonly failing: boolean;
}

/** `GET /api/v1/insights`. */
export interface InsightsResource {
  readonly range: MetricRange;
  /** The window's first and last UTC day. */
  readonly window: { readonly from: Day; readonly to: Day };
  /** `owner/name` when one repository was asked for, else null — the whole workspace. */
  readonly repo: string | null;
  /** Whether the window's usage was priced — the page-level statement of the money rule. */
  readonly usage: InsightsMoney;
  readonly head: InsightsHead;
  readonly kpis: readonly InsightsKpi[];
  readonly series: InsightsSeries;
  readonly hbars: InsightsBarCards;
  readonly performance: readonly InsightsPerformanceCell[];
  readonly flaky: InsightsFlaky;
  readonly scoreboard: Scoreboard;
  readonly dora: readonly InsightsDoraCell[];
  readonly freshness: InsightsFreshness;
}
