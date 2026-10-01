/**
 * The Insights page's number cards — the money rule, the head, the KPI row, the performance strip
 * and the DORA cells (BJ.2, [#438](https://github.com/NobuData/ouroboros/issues/438)).
 *
 * Pure: windows in, cards out. Every figure is a `MetricWindow` the windowed metrics service
 * (#437) answered, so nothing here computes a metric — it chooses which window a card shows, says
 * which way it moved and whether that is good, and applies the one money rule.
 */

import type { MetricMethodology, MetricWindow } from "../metrics/metrics.types";
import type {
  InsightsDoraCell,
  InsightsHead,
  InsightsKpi,
  InsightsKpiKey,
  InsightsMoney,
  InsightsPerformanceCell,
  InsightsTrend,
} from "./page.resources";

/** The windows a composer reads, by metric id. */
export type Windows = ReadonlyMap<string, MetricWindow>;

/**
 * A window the page asked for.
 *
 * @param windows - The windows read.
 * @param metricId - The metric.
 * @returns Its window.
 * @throws {Error} When the page's read did not include it — a programming error, not a request's.
 */
export function windowOf(windows: Windows, metricId: string): MetricWindow {
  const window = windows.get(metricId);

  if (window === undefined) {
    throw new Error(`The insights page composes ${metricId} but did not read it.`);
  }

  return window;
}

/**
 * **The money rule** (decision I8), in one place: tokens always, dollars only when priced.
 *
 * @param tokens - Every token the figure covers.
 * @param unpricedTokens - The part no price covers.
 * @param costCents - The priced spend, which is all `cost_cents` ever sums.
 * @returns `priced` with `costCents` when any token was priced; `unpriced` or `none` **without
 *   the key** otherwise — an unpriced figure is unknown, never `$0`.
 */
export function moneyOf(tokens: number, unpricedTokens: number, costCents: number): InsightsMoney {
  const pricing = tokens <= 0 ? "none" : unpricedTokens >= tokens ? "unpriced" : "priced";

  return { pricing, tokens, unpricedTokens, ...(pricing === "priced" ? { costCents } : {}) };
}

/**
 * Which way a figure moved, and whether that is the good way.
 *
 * @param delta - `value − prior`, or null when either is unknown.
 * @param higherIsBetter - The metric's polarity.
 * @returns `flat` with no judgement for no move or no comparison.
 */
export function trendOf(delta: number | null, higherIsBetter: boolean): InsightsTrend {
  if (delta === null || delta === 0) {
    return { direction: "flat", good: null };
  }

  return { direction: delta > 0 ? "up" : "down", good: delta > 0 === higherIsBetter };
}

/**
 * The page head's numbers — always the last seven days.
 *
 * @param week - The 7-day windows of `merged_prs` and `human_interventions`.
 * @returns What *"27 PRs merged this week. 2 needed a human."* is composed from.
 */
export function headOf(week: Windows): InsightsHead {
  return {
    range: "7d",
    mergedPrs: windowOf(week, "merged_prs").value ?? 0,
    interventions: windowOf(week, "human_interventions").value ?? 0,
  };
}

/** The KPI row: each card's metric and whether more of it is better. */
const KPI_ROW: readonly (readonly [InsightsKpiKey, metricId: string, higherIsBetter: boolean])[] = [
  ["autonomous_merge_rate", "merge_rate", true],
  ["merged_untouched_rate", "merged_untouched_rate", true],
  ["cycle_time", "cycle_time", false],
  ["cost_per_merged_pr", "cost_per_merged_pr", false],
  ["human_interventions", "human_interventions", false],
];

/**
 * A card straight from its window.
 *
 * @param key - The card.
 * @param window - Its window.
 * @param higherIsBetter - Its polarity.
 * @returns The card.
 */
function kpiFrom(key: InsightsKpiKey, window: MetricWindow, higherIsBetter: boolean): InsightsKpi {
  return {
    key,
    unit: window.methodology.unit,
    value: window.value,
    prior: window.prior,
    delta: window.delta,
    trend: trendOf(window.delta, higherIsBetter),
    methodology: window.methodology,
  };
}

/**
 * *Cost per merged PR* for usage no price covers: tokens per merged PR, under the `tokens`
 * methodology — the same question, answered in the only unit that is known.
 *
 * @param windows - The range's windows.
 * @returns The card, in tokens, with no dollar figure.
 */
function tokensPerMergedPr(windows: Windows): InsightsKpi {
  const tokens = windowOf(windows, "tokens");
  const merged = windowOf(windows, "merged_prs");
  const per = (used: number | null, merges: number | null): number | null =>
    used === null || merges === null || merges <= 0 ? null : used / merges;
  const value = per(tokens.value, merged.value);
  const prior = per(tokens.prior, merged.prior);
  const delta = value === null || prior === null ? null : value - prior;

  return {
    key: "cost_per_merged_pr",
    unit: "tokens",
    value,
    prior,
    delta,
    trend: trendOf(delta, false),
    methodology: tokens.methodology,
  };
}

/**
 * The five KPI cards, in row order.
 *
 * @param windows - The range's windows.
 * @param usage - The window's money state.
 * @returns The row. *Cost per merged PR* is in cents when the usage was priced and in tokens when
 *   it was not — never a dollar figure for unpriced usage.
 */
export function kpisOf(windows: Windows, usage: InsightsMoney): InsightsKpi[] {
  return KPI_ROW.map(([key, metricId, higherIsBetter]) =>
    key === "cost_per_merged_pr" && usage.pricing !== "priced"
      ? tokensPerMergedPr(windows)
      : kpiFrom(key, windowOf(windows, metricId), higherIsBetter),
  );
}

/** The strip's plain cells: each one a window's own figure. */
const PERFORMANCE_METRICS: readonly Exclude<InsightsPerformanceCell["key"], "total_cost">[] = [
  "builds",
  "build_success_rate",
  "test_cases_run",
  "test_pass_rate",
  "tokens",
];

/**
 * The build & test performance strip.
 *
 * @param windows - The range's windows.
 * @param usage - The window's money state.
 * @returns Six cells. *Total cost* is null — not zero — when the usage was not priced.
 */
export function performanceOf(windows: Windows, usage: InsightsMoney): InsightsPerformanceCell[] {
  const cells = PERFORMANCE_METRICS.map((key): InsightsPerformanceCell => {
    const window = windowOf(windows, key);

    return {
      key,
      unit: window.methodology.unit,
      value: window.value,
      ...(window.components ? { components: window.components } : {}),
      methodology: window.methodology,
    };
  });
  const cost: MetricMethodology = windowOf(windows, "cost_cents").methodology;

  return [
    ...cells,
    { key: "total_cost", unit: cost.unit, value: usage.costCents ?? null, methodology: cost },
  ];
}

/** The DORA strip: each cell's metric and whether more of it is better. */
const DORA_ROW: readonly (readonly [InsightsDoraCell["key"], higherIsBetter: boolean])[] = [
  ["deploy_frequency", true],
  ["lead_time", false],
  ["change_failure_rate", false],
  ["mttr", false],
];

/**
 * The four DORA cells.
 *
 * Deploy frequency is a count on the grain and a rate on the card: the window's deploys over its
 * days, so 7d, 30d and 90d read on one scale. The other three are their windows' own figures.
 * `proxy` is the registry's flag, carried through untouched — change failure rate and MTTR are
 * stand-ins, and the cell cannot be drawn as measured.
 *
 * @param windows - The range's windows.
 * @returns The cells, in strip order.
 */
export function doraOf(windows: Windows): InsightsDoraCell[] {
  return DORA_ROW.map(([key, higherIsBetter]): InsightsDoraCell => {
    const window = windowOf(windows, key);
    const perDay = key === "deploy_frequency";
    const days = window.series.length;
    const scale = (figure: number | null): number | null =>
      figure === null || !perDay ? figure : figure / days;
    const value = scale(window.value);
    const prior = scale(window.prior);
    const delta = value === null || prior === null ? null : value - prior;

    return {
      key,
      unit: perDay ? "per_day" : window.methodology.unit,
      value,
      prior,
      delta,
      trend: trendOf(delta, higherIsBetter),
      sparkline: window.series.map((point) => point.value),
      proxy: window.methodology.proxy,
      methodology: window.methodology,
    };
  });
}
