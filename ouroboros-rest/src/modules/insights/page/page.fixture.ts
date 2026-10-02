/**
 * Mockup 15, as the facts the Insights page is composed from (BJ.2,
 * [#438](https://github.com/NobuData/ouroboros/issues/438)).
 *
 * {@link mockupFacts} is a 30-day window ending 2026-08-08 — the mockup's `Jul 10 – Aug 8` —
 * holding the figures the insights seed (#436) reproduces: 96 of 104 closed PRs merged
 * autonomously, twenty interventions as 8 / 5 / 4 / 2 / 1, the stage medians whose other five sum
 * to 8m 20s, 33 failing cases of 26 430, and 126M tokens. Each composer's suite starts from it and
 * moves one thing, so a sentence that was typed rather than computed stops matching.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

import type { FlakeCardCase } from "../../flakes/flakes.resources";
import { metricWindow } from "../metrics/metrics.fixture";
import type {
  MetricBreakdown,
  MetricComponents,
  MetricMethodology,
  MetricWindow,
} from "../metrics/metrics.types";
import type { MetricRange } from "../metrics/metrics.window";
import type { Day } from "../rollup/rollup.types";
import type { Scoreboard } from "../scoreboard/scoreboard.types";
import type { PageFacts } from "./page.compose";
import type { BarBreakdowns } from "./page.hbars";
import type { InsightsBarCard, InsightsBarCards, InsightsFreshness } from "./page.resources";

/**
 * The five bar cards as a list, in the page's order.
 *
 * @param hbars - The page's bar cards.
 * @returns Interventions, stages, suites, effort, tokens.
 */
export function barCards(hbars: InsightsBarCards): InsightsBarCard[] {
  return [hbars.interventions, hbars.stages, hbars.suites, hbars.effort, hbars.tokens];
}

/**
 * Every key anywhere in a JSON value — how a gate's absent case is asserted: a withheld claim is a
 * missing key, so the scan must find none.
 *
 * @param value - The value.
 * @returns The keys, with repeats.
 */
export function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(keysOf);
  }

  if (typeof value !== "object" || value === null) {
    return [];
  }

  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
}

/**
 * Keys that carry dollars: every `…Cents` figure, and the three cost-chart sections that exist
 * only to hold one. (`cost` itself is the chart's name, and holds tokens too.)
 */
export const MONEY_KEY = /cents$|^budget$|^projection$|^spike$/i;

/** The fixture window's last day — the mockup's `Aug 8`. */
export const TODAY: Day = "2026-08-08";

/**
 * The UTC days of a window ending on a day.
 *
 * @param count - How many days.
 * @param last - The last one.
 * @returns The days, oldest first.
 */
export function daysEnding(count: number, last: Day = TODAY): Day[] {
  const end = Date.parse(`${last}T00:00:00.000Z`);

  return Array.from({ length: count }, (_, index) =>
    new Date(end - (count - 1 - index) * 86_400_000).toISOString().slice(0, 10),
  );
}

/** The fixture window's thirty days. */
export const DAYS: readonly Day[] = daysEnding(30);

/** How a fixture window differs from an empty one. */
export interface WindowOptions {
  readonly value?: number | null;
  readonly prior?: number | null;
  /** One value per day, oldest first; every day is `fill` when omitted. */
  readonly series?: readonly (number | null)[];
  /** What an unlisted day holds. */
  readonly fill?: number | null;
  readonly components?: MetricComponents;
  readonly unit?: MetricMethodology["unit"];
  readonly proxy?: boolean;
  readonly aggregation?: MetricMethodology["aggregation"];
  readonly days?: readonly Day[];
  readonly range?: MetricRange;
}

/**
 * A registry entry's methodology payload.
 *
 * @param metricId - The metric.
 * @param options - Its unit, proxy flag and aggregation.
 * @returns The payload.
 */
export function methodology(
  metricId: string,
  options: Pick<WindowOptions, "unit" | "proxy" | "aggregation"> = {},
): MetricMethodology {
  return {
    metricId,
    title: `Title of ${metricId}`,
    formula: `Formula of ${metricId}`,
    sources: ["runs"],
    caveats: `Caveats of ${metricId}`,
    unit: options.unit ?? "count",
    version: 1,
    proxy: options.proxy ?? false,
    aggregation: options.aggregation ?? "sum",
  };
}

/**
 * A metric's window over the fixture's days — `metricWindow` (#437's stand-in) with a point per
 * day, a delta that follows from the figures, and the methodology's unit and proxy flag set.
 *
 * @param metricId - The metric.
 * @param options - Its figures.
 * @returns The window, with a point per day.
 */
export function pageWindow(metricId: string, options: WindowOptions = {}): MetricWindow {
  const days = options.days ?? DAYS;
  const value = options.value === undefined ? 0 : options.value;
  const prior = options.prior === undefined ? 0 : options.prior;
  const fill = options.fill === undefined ? 0 : options.fill;

  return metricWindow(metricId, {
    range: options.range ?? "30d",
    from: days[0],
    to: days[days.length - 1],
    value,
    ...(options.components ? { components: options.components } : {}),
    prior,
    delta: value === null || prior === null ? null : value - prior,
    series: days.map((day, index) => ({
      day,
      value: options.series === undefined ? fill : options.series[index],
      meta: {},
    })),
    methodology: methodology(metricId, options),
  });
}

/**
 * A map of windows by metric id.
 *
 * @param windows - The windows.
 * @returns The map the composers read.
 */
export function windowsOf(...windows: MetricWindow[]): Map<string, MetricWindow> {
  return new Map(windows.map((window) => [window.metricId, window]));
}

/**
 * A dimensioned metric's breakdown.
 *
 * @param metricId - The metric.
 * @param dimensionKind - What the labels are.
 * @param entries - `[label, value, prior?]`, in any order.
 * @param options - The metric's unit and aggregation.
 * @returns The breakdown, labels ascending as the service answers it.
 */
export function breakdownOf(
  metricId: string,
  dimensionKind: MetricBreakdown["dimensionKind"],
  entries: readonly (readonly [label: string, value: number | null, prior?: number | null])[],
  options: Pick<WindowOptions, "unit" | "aggregation"> = {},
): MetricBreakdown {
  return {
    metricId,
    dimensionKind,
    range: "30d",
    from: DAYS[0],
    to: TODAY,
    entries: [...entries]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dimension, value, prior]) => ({
        dimension,
        window: pageWindow(metricId, { value, prior: prior ?? 0, ...options }),
      })),
    methodology: methodology(metricId, options),
  };
}

/** A series of thirty days with some of them set. */
function seriesWith(fill: number, set: Readonly<Record<number, number>>): number[] {
  return DAYS.map((_, index) => set[index] ?? fill);
}

/** Mockup 15's bar cards, as the seed stores them. */
export function mockupBreakdowns(): BarBreakdowns {
  return {
    interventions: breakdownOf("human_interventions", "cause", [
      ["infra_rig", 8, 9],
      ["ambiguous_ticket", 5, 7],
      ["policy_gate", 4, 5],
      ["model_disagreement", 2, 3],
      ["other", 1, 1],
    ]),
    stages: breakdownOf(
      "stage_duration",
      "stage",
      [
        ["analyze", 60_000],
        ["plan", 120_000],
        ["implement", 364_000],
        ["build", 120_000],
        ["test", 160_000],
        ["review", 40_000],
      ],
      { unit: "duration_ms", aggregation: "median" },
    ),
    suites: breakdownOf("test_failures_by_suite", "suite", [
      ["telemetry integration", 14],
      ["PHYSICAL · HIL rig", 10],
      ["OTA update", 5],
      ["motor control", 3],
      ["unit · drivers", 1],
    ]),
    effort: breakdownOf(
      "completion_time_by_effort",
      "effort",
      [
        ["xs", 360_000],
        ["s", 660_000],
        ["m", 1_140_000],
        ["l", 2_880_000],
        ["xl", 7_800_000],
      ],
      { unit: "duration_ms", aggregation: "median" },
    ),
    tokens: breakdownOf(
      "tokens_by_task_kind",
      "task_kind",
      [
        ["implement", 71_000_000],
        ["review", 18_000_000],
        ["plan", 14_000_000],
        ["analyze", 12_000_000],
        ["test-gen", 8_000_000],
        ["docs", 3_000_000],
      ],
      { unit: "tokens" },
    ),
  };
}

/** Mockup 15's undimensioned figures for the 30-day window. */
export function mockupWindows(): Map<string, MetricWindow> {
  return windowsOf(
    pageWindow("merge_rate", {
      value: (100 * 96) / 104,
      prior: (100 * 97) / 109,
      components: { numerator: 96, denominator: 104 },
      unit: "pct",
      aggregation: "ratio",
      fill: null,
    }),
    pageWindow("merged_untouched_rate", {
      value: (100 * 76) / 97,
      prior: 75,
      components: { numerator: 76, denominator: 97 },
      unit: "pct",
      aggregation: "ratio",
      fill: null,
    }),
    pageWindow("cycle_time", {
      value: 860_000,
      prior: 980_000,
      unit: "duration_ms",
      aggregation: "median",
      fill: null,
    }),
    pageWindow("cost_per_merged_pr", {
      value: 18_160 / 97,
      prior: 228,
      components: { numerator: 18_160, denominator: 97 },
      unit: "cents",
      aggregation: "ratio",
      fill: null,
    }),
    pageWindow("human_interventions", {
      value: 20,
      prior: 25,
      // Aug 4: one intervention.
      series: seriesWith(0, { 25: 1 }),
    }),
    // Aug 4 (four days before the end) merged six; today ends the chart at six.
    pageWindow("merged_prs", { value: 97, prior: 109, series: seriesWith(3, { 25: 6, 29: 6 }) }),
    pageWindow("tokens", {
      value: 126_000_000,
      prior: 140_000_000,
      unit: "tokens",
      fill: 4_200_000,
    }),
    pageWindow("unpriced_tokens", {
      value: 5_000_000,
      prior: 6_000_000,
      unit: "tokens",
      fill: 150_000,
    }),
    // A gentle month, the $31.40 spike eight days ago, Aug 4's $9.12 and today's $18.60.
    pageWindow("cost_cents", {
      value: 18_160,
      prior: 24_850,
      unit: "cents",
      series: seriesWith(500, { 21: 3_140, 25: 912, 29: 1_860 }),
    }),
    pageWindow("local_tokens", { value: 39_060_000, unit: "tokens", fill: 1_302_000 }),
    pageWindow("builds", { value: 412, prior: 398, series: seriesWith(14, { 28: 18 }) }),
    pageWindow("build_failures", { value: 35, prior: 40, series: seriesWith(1, { 28: 2 }) }),
    pageWindow("build_success_rate", {
      value: (100 * 377) / 412,
      prior: 90,
      components: { numerator: 377, denominator: 412 },
      unit: "pct",
      aggregation: "ratio",
      fill: null,
    }),
    pageWindow("test_cases_run", { value: 26_430, prior: 25_000, fill: 881 }),
    pageWindow("test_pass_rate", {
      value: (100 * 26_397) / 26_430,
      prior: 99.8,
      components: { numerator: 26_397, denominator: 26_430 },
      unit: "pct",
      aggregation: "ratio",
      fill: null,
    }),
    // 126 deploys over thirty days is the cell's 4.2 a day.
    pageWindow("deploy_frequency", { value: 126, prior: 108, fill: 4 }),
    pageWindow("lead_time", {
      value: 1_680_000,
      prior: 2_058_000,
      unit: "duration_ms",
      aggregation: "ratio",
      fill: null,
    }),
    pageWindow("change_failure_rate", {
      value: 3.1,
      prior: 3.1,
      unit: "pct",
      aggregation: "ratio",
      proxy: true,
      fill: null,
    }),
    pageWindow("mttr", {
      value: 1_320_000,
      prior: 1_680_000,
      unit: "duration_ms",
      aggregation: "ratio",
      proxy: true,
      fill: null,
    }),
  );
}

/** The head's week: *"27 PRs merged this week. 2 needed a human."* */
export function mockupWeek(): Map<string, MetricWindow> {
  const days = daysEnding(7);

  return windowsOf(
    pageWindow("merged_prs", { value: 27, prior: 22, days, range: "7d" }),
    pageWindow("human_interventions", { value: 2, prior: 7, days, range: "7d" }),
  );
}

/**
 * The 90-day money windows the projection reads: the month so far is August's eight days.
 *
 * @param cents - Each August day's priced spend, oldest first.
 * @returns The windows.
 */
export function quarterWith(cents: readonly number[] = [500, 500, 500, 912, 500, 500, 500, 1_860]) {
  const days = daysEnding(90);
  const month = (values: readonly number[], fill: number): number[] =>
    days.map((_, index) => {
      const fromEnd = days.length - 1 - index;

      return fromEnd < values.length ? values[values.length - 1 - fromEnd] : fill;
    });

  return windowsOf(
    pageWindow("tokens", { days, range: "90d", unit: "tokens", fill: 4_200_000 }),
    pageWindow("unpriced_tokens", { days, range: "90d", unit: "tokens", fill: 150_000 }),
    pageWindow("cost_cents", { days, range: "90d", unit: "cents", series: month(cents, 700) }),
  );
}

/** An empty scoreboard — BJ.3's payload for a window with no resolved merges. */
export function emptyScoreboard(): Scoreboard {
  const column = methodology("scoreboard_merged");

  return {
    range: "30d",
    window: { from: DAYS[0], to: TODAY },
    prior: { from: "2026-06-10", to: "2026-07-09" },
    minSample: 10,
    rows: [],
    methodology: { untouched: column, costPerSuccess: column, trend: column, sample: column },
  };
}

/**
 * A flaky-card case.
 *
 * @param overrides - What differs from a quarantined HIL case flaking on one rig.
 * @returns The case.
 */
export function flakyCase(overrides: Partial<FlakeCardCase> = {}): FlakeCardCase {
  return {
    caseKey: "a".repeat(64),
    repository: "helios-firmware",
    name: "tests/hil/test_estop_release.py",
    classname: "tests.hil",
    suite: "physical · HIL",
    state: "quarantined",
    score: 0.41,
    stateChangedAt: "2026-07-28T10:00:00.000Z",
    observed: 100,
    flaky: 4,
    history: [
      { day: "2026-07-12", observed: 50, flaky: 1 },
      { day: "2026-08-04", observed: 50, flaky: 3 },
    ],
    platform: "rig:hil-rig-02",
    resolvedBy: null,
    ...overrides,
  };
}

/** Rollups filled through yesterday, an hour ago — a page that is current. */
export const CURRENT_FRESHNESS: InsightsFreshness = Object.freeze({
  filledThrough: "2026-08-08",
  lastFilledAt: "2026-08-09T11:00:00.000Z",
  behind: false,
  failing: false,
});

/**
 * Everything the page is composed from, as mockup 15 draws it.
 *
 * @param overrides - What a case changes.
 * @returns The facts.
 */
export function mockupFacts(overrides: Partial<PageFacts> = {}): PageFacts {
  return {
    range: "30d",
    repo: "acme-robotics/helios-firmware",
    week: mockupWeek(),
    windows: mockupWindows(),
    quarter: quarterWith(),
    breakdowns: mockupBreakdowns(),
    calibration: { withinBandPct: (100 * 8) / 9 },
    // The mockup's `$600 cap`, and its `$20 budget` guide in a thirty-day month's terms.
    caps: { monthlyCapCents: 60_000, connections: 2 },
    flaky: [flakyCase()],
    scoreboard: emptyScoreboard(),
    freshness: CURRENT_FRESHNESS,
    ...overrides,
  };
}

/**
 * The facts with one window replaced.
 *
 * @param facts - The facts.
 * @param window - The replacement.
 * @returns New facts.
 */
export function withWindow(facts: PageFacts, window: MetricWindow): PageFacts {
  return { ...facts, windows: new Map([...facts.windows, [window.metricId, window]]) };
}

/**
 * A workspace nothing prices: every token unpriced, and no cost row at all.
 *
 * @returns The facts.
 */
export function unpricedFacts(): PageFacts {
  const facts = mockupFacts();
  const windows = new Map(facts.windows);

  windows.set(
    "unpriced_tokens",
    pageWindow("unpriced_tokens", { value: 126_000_000, unit: "tokens", fill: 4_200_000 }),
  );
  windows.set("cost_cents", pageWindow("cost_cents", { value: 0, prior: 0, unit: "cents" }));
  windows.set(
    "cost_per_merged_pr",
    pageWindow("cost_per_merged_pr", {
      value: 0,
      prior: 0,
      unit: "cents",
      aggregation: "ratio",
      fill: null,
    }),
  );

  const days = daysEnding(90);

  return {
    ...facts,
    windows,
    quarter: windowsOf(
      pageWindow("tokens", { days, range: "90d", unit: "tokens", fill: 4_200_000 }),
      pageWindow("unpriced_tokens", { days, range: "90d", unit: "tokens", fill: 4_200_000 }),
      pageWindow("cost_cents", { days, range: "90d", unit: "cents" }),
    ),
  };
}
