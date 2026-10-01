/**
 * The Insights page's time series — throughput with its tooltip, cost with its budget guide,
 * projection and spike, and the stacked builds (BJ.2,
 * [#438](https://github.com/NobuData/ouroboros/issues/438), decision **I8**).
 *
 * Pure: windows and the workspace's caps in, series out.
 *
 *   * **The tooltip is the same day's sibling series.** *"Aug 4 — 6 merged · $9.12 · 1
 *     intervention"* is three metrics' points for one day, so it cannot disagree with the cost
 *     chart or the interventions card.
 *   * **A day's dollars exist only when that day's usage was priced** — the money rule, per day.
 *   * **The budget guide is the real caps** — the workspace's own `monthly_cap_cents`, summed —
 *     and it is absent when there are none. The *"alerts fire at 90%"* claim has no key at all:
 *     nothing fires an alert until #237.
 *   * **The projection states its method** — linear-to-date — and its inputs.
 *   * **The spike is a plain value.** One day well above the window's ordinary days is marked
 *     with its date and amount; nothing in the product attributes it to a cause, so no cause is
 *     written.
 */

import { median } from "../rollup/rollup.rows";
import type { Day } from "../rollup/rollup.types";
import type { MetricWindow } from "../metrics/metrics.types";
import { moneyOf, windowOf, type Windows } from "./page.cards";
import type {
  InsightsBudget,
  InsightsCostPoint,
  InsightsCostSpike,
  InsightsMoney,
  InsightsProjection,
  InsightsSeries,
  InsightsThroughputPoint,
} from "./page.resources";

/** A day stands out when it costs at least this many times the window's median priced day. */
export const SPIKE_FACTOR = 2;

/** The fewest priced days a window needs before one of them can be called a spike. */
export const SPIKE_MIN_DAYS = 5;

/** The workspace's provider caps, as the page read them. */
export interface ProviderCaps {
  /** Every enabled connection's monthly cap, summed; null when none has one. */
  readonly monthlyCapCents: number | null;
  /** How many connections that is the sum of. */
  readonly connections: number;
}

/**
 * Each day's money: every token, and the priced spend when the day had any.
 *
 * @param windows - Windows holding `tokens`, `unpriced_tokens` and `cost_cents`.
 * @returns One entry per day of the window, oldest first.
 */
function dailyMoney(windows: Windows): { day: Day; money: InsightsMoney }[] {
  const tokens = windowOf(windows, "tokens").series;
  const unpriced = windowOf(windows, "unpriced_tokens").series;
  const cost = windowOf(windows, "cost_cents").series;

  return tokens.map((point, index) => ({
    day: point.day,
    money: moneyOf(point.value ?? 0, unpriced[index].value ?? 0, cost[index].value ?? 0),
  }));
}

/**
 * The throughput chart's points.
 *
 * @param windows - The range's windows.
 * @returns One point per day: merges, interventions and — when priced — that day's spend.
 */
function throughputPoints(windows: Windows): InsightsThroughputPoint[] {
  const merged = windowOf(windows, "merged_prs").series;
  const interventions = windowOf(windows, "human_interventions").series;

  return dailyMoney(windows).map(({ day, money }, index) => ({
    day,
    mergedPrs: merged[index].value ?? 0,
    interventions: interventions[index].value ?? 0,
    ...(money.costCents === undefined ? {} : { costCents: money.costCents }),
  }));
}

/**
 * How many days a UTC month has.
 *
 * @param day - Any day of it.
 * @returns 28–31.
 */
export function daysInMonth(day: Day): number {
  const [year, month] = day.split("-").map(Number);

  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The budget guide.
 *
 * @param caps - The workspace's caps.
 * @param today - The window's last day; the guide is the cap spread over its month.
 * @returns The guide, or undefined when no connection has a cap.
 */
export function budgetOf(caps: ProviderCaps, today: Day): InsightsBudget | undefined {
  if (caps.monthlyCapCents === null || caps.monthlyCapCents <= 0) {
    return undefined;
  }

  return {
    monthlyCapCents: caps.monthlyCapCents,
    dailyCents: Math.round(caps.monthlyCapCents / daysInMonth(today)),
    connections: caps.connections,
  };
}

/**
 * The month's projected spend, linear-to-date.
 *
 * @param quarter - 90-day windows of `tokens`, `unpriced_tokens` and `cost_cents` — long enough
 *   to hold the whole of the current month whatever range the page shows.
 * @param today - The window's last day.
 * @returns The projection, or undefined when nothing was priced this month.
 */
export function projectionOf(quarter: Windows, today: Day): InsightsProjection | undefined {
  const month = today.slice(0, 7);
  const days = dailyMoney(quarter).filter(({ day }) => day.startsWith(month));
  const priced = days.filter(({ money }) => money.costCents !== undefined);

  if (priced.length === 0) {
    return undefined;
  }

  const monthToDateCents = priced.reduce((total, { money }) => total + (money.costCents ?? 0), 0);
  const daysElapsed = Number(today.slice(8, 10));
  const inMonth = daysInMonth(today);

  return {
    method: "linear_to_date",
    monthToDateCents,
    projectedCents: Math.round((monthToDateCents / daysElapsed) * inMonth),
    daysElapsed,
    daysInMonth: inMonth,
  };
}

/**
 * The cost chart's one annotated day.
 *
 * @param points - The window's cost points.
 * @returns The highest priced day when it costs at least {@link SPIKE_FACTOR} times the median
 *   priced day and the window has {@link SPIKE_MIN_DAYS} priced days to compare it with; else
 *   undefined.
 */
export function spikeOf(points: readonly InsightsCostPoint[]): InsightsCostSpike | undefined {
  const priced = points.flatMap((point) =>
    point.costCents === undefined ? [] : [{ day: point.day, costCents: point.costCents }],
  );

  if (priced.length < SPIKE_MIN_DAYS) {
    return undefined;
  }

  const typical = median(priced.map((point) => point.costCents).sort((a, b) => a - b));
  const peak = priced.reduce((highest, point) =>
    point.costCents > highest.costCents ? point : highest,
  );

  return typical > 0 && peak.costCents >= SPIKE_FACTOR * typical ? peak : undefined;
}

/**
 * The page's three series.
 *
 * @param windows - The range's windows.
 * @param quarter - The 90-day cost windows the projection reads.
 * @param caps - The workspace's provider caps.
 * @param usage - The window's money state: with no priced usage there is no guide to compare to.
 * @returns Throughput, cost and builds.
 */
export function seriesOf(
  windows: Windows,
  quarter: Windows,
  caps: ProviderCaps,
  usage: InsightsMoney,
): InsightsSeries {
  const merged: MetricWindow = windowOf(windows, "merged_prs");
  const cost = windowOf(windows, "cost_cents");
  const builds = windowOf(windows, "builds");
  const failures = windowOf(windows, "build_failures").series;
  const points: InsightsCostPoint[] = dailyMoney(windows).map(({ day, money }) => ({
    day,
    tokens: money.tokens,
    ...(money.costCents === undefined ? {} : { costCents: money.costCents }),
  }));
  const budget = usage.pricing === "priced" ? budgetOf(caps, cost.to) : undefined;
  const projection = projectionOf(quarter, cost.to);
  const spike = spikeOf(points);

  return {
    throughput: { points: throughputPoints(windows), methodology: merged.methodology },
    cost: {
      points,
      ...(budget ? { budget } : {}),
      ...(projection ? { projection } : {}),
      ...(spike ? { spike } : {}),
      methodology: cost.methodology,
    },
    builds: {
      points: builds.series.map((point, index) => {
        const failed = failures[index].value ?? 0;

        return { day: point.day, succeeded: (point.value ?? 0) - failed, failed };
      }),
      methodology: builds.methodology,
    },
  };
}
