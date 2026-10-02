import type {
  InsightsKpi,
  InsightsPage,
  InsightsRange,
  MetricMethodology,
} from "@/app/api/insights";
import type { InsightsReadings } from "@/app/insights/data";

/**
 * The insights page as the frame (#443) reads it — mockup 15's head and KPI row.
 *
 * Only what is mounted is built: `range`, `window`, `repo`, `usage`, `head`, `kpis` and — for the
 * time-series cards (#444) — `series.throughput` and `series.cost`. The cards #445–#447 add read
 * the rest of the payload, so the remainder is left out and the object is cast — a later card's
 * suite extends this fixture with its own section rather than this one inventing data nobody
 * asserts on.
 */

/** When the seeded page was read, held still. */
export const INSIGHTS_READ_AT = Date.UTC(2026, 7, 8, 14, 2);

/**
 * A registry entry, with the openapi example's words.
 *
 * @param over What differs.
 * @returns The entry.
 */
export function methodology(over: Partial<MetricMethodology> = {}): MetricMethodology {
  return {
    metricId: "merge_rate",
    title: "Autonomous merge rate",
    formula:
      "Loop PRs that merged without a human intervention, divided by all loop PRs that closed (merged or not) in the window.",
    sources: ["pull_requests", "runs"],
    caveats: "A window's rate is total autonomous merges over total closed PRs, not an average of daily rates.",
    unit: "pct",
    version: 1,
    proxy: false,
    aggregation: "ratio",
    ...over,
  };
}

/** The I6 definition, as V076 registers it for `merged_untouched_rate`. */
export const I6_FORMULA =
  "Merged PRs whose revisions contain no human-authored pushes and no human-edited files after the loop's last revision, divided by all merged PRs.";

/**
 * One KPI card.
 *
 * @param over What differs from the seeded merge-rate card.
 * @returns The card.
 */
export function kpi(over: Partial<InsightsKpi> = {}): InsightsKpi {
  return {
    key: "autonomous_merge_rate",
    unit: "pct",
    value: 92,
    prior: 89,
    delta: 3,
    trend: { direction: "up", good: true },
    methodology: methodology(),
    ...over,
  };
}

/** Mockup 15's five cards over 30 days. */
export function seededKpis(): InsightsKpi[] {
  return [
    kpi(),
    kpi({
      key: "merged_untouched_rate",
      value: 78,
      prior: 80,
      delta: -2,
      trend: { direction: "down", good: false },
      methodology: methodology({
        metricId: "merged_untouched_rate",
        title: "Merged w/o human edits",
        formula: I6_FORMULA,
        sources: ["pull_requests"],
        caveats:
          "Authorship comes from host sync; a human edit made outside the host (a squash rewrite) is not seen.",
      }),
    }),
    kpi({
      key: "cycle_time",
      unit: "duration_ms",
      value: 860_000,
      prior: 980_000,
      delta: -120_000,
      trend: { direction: "down", good: true },
      methodology: methodology({
        metricId: "cycle_time",
        title: "Median cycle",
        unit: "duration_ms",
        aggregation: "median",
        sources: ["runs"],
      }),
    }),
    kpi({
      key: "cost_per_merged_pr",
      unit: "cents",
      value: 187,
      prior: 228,
      delta: -41,
      trend: { direction: "down", good: true },
      methodology: methodology({
        metricId: "cost_per_merged_pr",
        title: "Cost per merged PR",
        unit: "cents",
        sources: ["usage", "pull_requests"],
      }),
    }),
    kpi({
      key: "human_interventions",
      unit: "count",
      value: 9,
      prior: 30,
      delta: -21,
      trend: { direction: "down", good: true },
      methodology: methodology({
        metricId: "human_interventions",
        title: "Human interventions",
        unit: "count",
        version: 2,
        aggregation: "sum",
        sources: ["runs", "tests", "interventions"],
      }),
    }),
  ];
}

/** The seeded window's thirty UTC days, Jul 10 – Aug 8 2026. */
export const SEEDED_DAYS: readonly string[] = Array.from({ length: 30 }, (_, index) =>
  new Date(Date.UTC(2026, 6, 10 + index)).toISOString().slice(0, 10),
);

/** Merged PRs per day, read off mockup 15's throughput polyline — ending at `6`. */
const SEEDED_MERGED = [3, 1, 0, 3, 4, 3, 4, 4, 1, 1, 4, 5, 4, 5, 4, 1, 2, 5, 4, 6, 5, 5, 2, 1, 5, 6, 5, 6, 5, 6];

/** Interventions per day — the mockup's Aug 4 has one. */
const SEEDED_INTERVENTIONS = [1, 0, 0, 2, 1, 0, 1, 0, 2, 1, 0, 1, 0, 0, 1, 2, 1, 0, 0, 1, 0, 1, 2, 1, 0, 1, 0, 0, 1, 0];

/** Daily priced spend, read off the cost polyline — rising to `$18.60`, spiking to `$31.40`. */
const SEEDED_COST_CENTS = [
  1310, 1410, 1280, 1510, 1440, 1570, 1510, 1630, 1510, 1570, 1670, 1600, 1730, 1670, 1700, 1600, 1670, 1790,
  1700, 1830, 1950, 3140, 2470, 1990, 1830, 1920, 1830, 1890, 1790, 1860,
];

/** The index of Aug 4 — the mockup's crosshair day, `6 merged · $9.12 · 1 intervention`. */
export const AUG_4 = 25;

/** The seeded spike's day — Jul 31, `$31.40`. */
export const SPIKE_DAY = SEEDED_DAYS[21]!;

/**
 * The seeded throughput and cost series — mockup 15's two charts, with a `$20` daily budget from
 * a `$600` cap and a `$571` linear-to-date projection.
 *
 * @returns The series the two time-series cards read.
 */
export function seededSeries(): InsightsPage["series"] {
  return {
    throughput: {
      points: SEEDED_DAYS.map((day, index) => ({
        day,
        mergedPrs: SEEDED_MERGED[index]!,
        interventions: SEEDED_INTERVENTIONS[index]!,
        costCents: index === AUG_4 ? 912 : 140 + SEEDED_MERGED[index]! * 152,
      })),
      methodology: methodology({ metricId: "throughput", title: "Merged PRs per day", unit: "count", aggregation: "sum" }),
    },
    cost: {
      points: SEEDED_DAYS.map((day, index) => ({
        day,
        tokens: SEEDED_COST_CENTS[index]! * 550,
        costCents: SEEDED_COST_CENTS[index]!,
      })),
      budget: { monthlyCapCents: 60_000, dailyCents: 2000, connections: 2 },
      projection: {
        method: "linear_to_date",
        monthToDateCents: 14_734,
        projectedCents: 57_100,
        daysElapsed: 8,
        daysInMonth: 31,
      },
      spike: { day: SPIKE_DAY, costCents: 3140 },
      methodology: methodology({ metricId: "daily_cost", title: "Daily cost", unit: "cents", aggregation: "sum" }),
    },
    builds: { points: [], methodology: methodology({ metricId: "builds", unit: "count", aggregation: "sum" }) },
  };
}

/**
 * The seeded page.
 *
 * @param over What differs — a range, a head, other cards.
 * @returns The page.
 */
export function seededInsights(over: Partial<InsightsPage> = {}): InsightsPage {
  return {
    range: "30d",
    window: { from: "2026-07-10", to: "2026-08-08" },
    repo: null,
    usage: { pricing: "priced", tokens: 27_846_076, unpricedTokens: 0, costCents: 5049 },
    head: { range: "7d", mergedPrs: 27, interventions: 2 },
    kpis: seededKpis(),
    series: seededSeries(),
    ...over,
  } as InsightsPage;
}

/**
 * What the route reads for the first paint.
 *
 * @param page The page, or `null` for a read that failed.
 * @param range The range it was read for. Defaults to the page's own.
 * @returns The readings.
 */
export function insightsReadings(
  page: InsightsPage | null = seededInsights(),
  range: InsightsRange = page?.range ?? "30d",
): InsightsReadings {
  return {
    range,
    page: page === null ? { ok: false, reason: "Choose a workspace." } : { ok: true, value: page },
    readAt: INSIGHTS_READ_AT,
  };
}
