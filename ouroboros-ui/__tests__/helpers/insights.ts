import type {
  InsightsBarCard,
  InsightsFlakyCase,
  InsightsKpi,
  InsightsPage,
  InsightsPerformanceCell,
  InsightsRange,
  MetricMethodology,
  Scoreboard,
  ScoreboardRow,
} from "@/app/api/insights";
import type { InsightsReadings } from "@/app/insights/data";
import type { FlakyPlaybook } from "@/app/insights/flaky-view";

/**
 * The insights page as the frame (#443) reads it — mockup 15's head and KPI row.
 *
 * Only what is mounted is built: `range`, `window`, `repo`, `usage`, `head`, `kpis`, — for the
 * time-series cards (#444) — `series.throughput` and `series.cost`, and — for the scoreboard and
 * the two bar cards (#445) — `scoreboard`, `hbars.interventions` and `hbars.stages`, and — for
 * the strip, the secondary charts and the flaky card (#446) — `performance`, `series.builds`,
 * `hbars.suites`, `hbars.effort`, `hbars.tokens` and `flaky`. The DORA strip #447 adds reads the
 * rest of the payload, so the remainder is left out and the object is cast — a later card's suite
 * extends this fixture with its own section rather than this one inventing data nobody asserts on.
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
    builds: {
      points: SEEDED_DAYS.map((day, index) => ({
        day,
        succeeded: SEEDED_BUILDS_OK[index]!,
        failed: SEEDED_BUILDS_FAILED[index]!,
      })),
      methodology: methodology({ metricId: "builds", unit: "count", aggregation: "sum" }),
    },
  };
}

/** Succeeded builds per day, read off mockup 15's stacked bars — a weekday rhythm. */
const SEEDED_BUILDS_OK = [14, 5, 4, 12, 15, 14, 17, 16, 6, 4, 12, 15, 16, 11, 16, 5, 3, 12, 15, 17, 16, 14, 6, 4, 12, 16, 11, 17, 14, 6];

/** Failed builds per day — the mockup's eight failure days, 35 in all. */
const SEEDED_BUILDS_FAILED = [0, 0, 0, 4, 0, 0, 0, 2, 0, 0, 5, 0, 0, 3, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 7, 0, 4, 0, 4, 0];

/** The index of the seeded worst build day — Aug 3, `19 · 7 failed`. */
export const WORST_BUILD_DAY = 24;

/** The I6 untouched definition's `$ / success` sibling, as BJ.3 registers it. */
export const COST_PER_SUCCESS_FORMULA =
  "Priced spend on the row's task kind divided by its merged PRs — a merge is a success; loops that did not merge are paid for by the ones that did.";

/**
 * One bar card.
 *
 * @param bars The bars, as `[key, label, value]`.
 * @param over What else differs — the line, the unit, the total.
 * @returns The card.
 */
export function barCard(
  bars: readonly (readonly [string, string, number])[],
  over: Partial<InsightsBarCard> = {},
): InsightsBarCard {
  return {
    unit: "count",
    total: bars.reduce((sum, [, , value]) => sum + value, 0),
    bars: bars.map(([key, label, value]) => ({ key, label, value })),
    line: null,
    methodology: methodology({ metricId: "human_interventions", unit: "count", aggregation: "sum" }),
    ...over,
  };
}

/** Mockup 15's *Where loops still need humans* — `30d · 20 total`. */
export function seededInterventions(): InsightsBarCard {
  return barCard(
    [
      ["infra_rig", "Flaky env / rig", 8],
      ["ambiguous_ticket", "Ambiguous ticket", 5],
      ["policy_gate", "Policy gate", 4],
      ["model_disagreement", "Model disagreement", 2],
      ["other", "Other", 1],
    ],
    { line: "Fix the top row and interventions drop ~40%." },
  );
}

/** Mockup 15's *Cycle time by stage · median*, in milliseconds. */
export function seededStages(): InsightsBarCard {
  return barCard(
    [
      ["analyze", "Analyze", 60_000],
      ["plan", "Plan", 120_000],
      ["implement", "Implement", 364_000],
      ["build", "Build", 120_000],
      ["test", "Test", 160_000],
      ["review", "Verify", 40_000],
    ],
    {
      unit: "duration_ms",
      total: null,
      line: "Implement dominates the loop — the other five stages sum to 8m 20s.",
      methodology: methodology({ metricId: "stage_duration", unit: "duration_ms", aggregation: "median" }),
    },
  );
}

/** Mockup 15's *Test failures by suite · 30d* — `33 cases`. */
export function seededSuites(): InsightsBarCard {
  return barCard(
    [
      ["telemetry integration", "telemetry integration", 14],
      ["OTA update", "OTA update", 9],
      ["physical · HIL", "physical · HIL", 6],
      ["motor control", "motor control", 3],
      ["unit · drivers", "unit · drivers", 1],
    ],
    {
      line: "33 failing cases total — 0.12% of everything that ran.",
      methodology: methodology({ metricId: "test_failures_by_suite", unit: "count", aggregation: "sum" }),
    },
  );
}

/** Mockup 15's *Time to completion by effort*, in milliseconds — XS `6m` to XL `2h 10m`. */
export function seededEffort(): InsightsBarCard {
  return barCard(
    [
      ["xs", "XS", 360_000],
      ["s", "S", 660_000],
      ["m", "M", 1_140_000],
      ["l", "L", 2_880_000],
      ["xl", "XL", 7_800_000],
    ],
    {
      unit: "duration_ms",
      total: null,
      line: "Estimator calibration: 89% of issues land within their predicted band.",
      methodology: methodology({ metricId: "completion_time_by_effort", unit: "duration_ms", aggregation: "median" }),
    },
  );
}

/** Mockup 15's *Tokens by stage · 30d* — `126M total`. */
export function seededTokens(): InsightsBarCard {
  return barCard(
    [
      ["implement", "implement", 71_000_000],
      ["review", "review", 18_000_000],
      ["plan", "plan", 14_000_000],
      ["analyze", "analyze", 12_000_000],
      ["test-gen", "test-gen", 8_000_000],
      ["docs", "docs", 3_000_000],
    ],
    {
      unit: "tokens",
      total: 126_000_000,
      line: "≈ 4.6M tokens per merged PR · 31% served by local models.",
      methodology: methodology({ metricId: "tokens_by_task_kind", unit: "tokens", aggregation: "sum" }),
    },
  );
}

/**
 * One performance cell.
 *
 * @param key Which cell.
 * @param unit Its unit.
 * @param value Its value.
 * @param components A rate's parts.
 * @returns The cell.
 */
export function perfCell(
  key: InsightsPerformanceCell["key"],
  unit: InsightsPerformanceCell["unit"],
  value: number | null,
  components?: InsightsPerformanceCell["components"],
): InsightsPerformanceCell {
  return {
    key,
    unit,
    value,
    ...(components === undefined ? {} : { components }),
    methodology: methodology({ metricId: key, unit, aggregation: unit === "pct" ? "ratio" : "sum" }),
  };
}

/** Mockup 15's build & test strip — `412 · 91.5% (377 ✓ / 35 ✗) · 26.4k · 98.9% · 126M · $563.20`. */
export function seededPerformance(): InsightsPerformanceCell[] {
  return [
    perfCell("builds", "count", 412),
    perfCell("build_success_rate", "pct", 91.5, { numerator: 377, denominator: 412 }),
    perfCell("test_cases_run", "count", 26_400),
    perfCell("test_pass_rate", "pct", 98.9, { numerator: 26_110, denominator: 26_400 }),
    perfCell("tokens", "tokens", 126_000_000),
    perfCell("total_cost", "cents", 56_320),
  ];
}

/** The seeded flaky window's run id for the loop that fixed `test_frame_order`. */
export const FIXING_RUN_ID = "0b6c5e1a-6a51-4d43-9b1e-7f1c1b0f1847";

/**
 * A flaky history from rates, one per day.
 *
 * @param rates Each day's rate, `null` for a day it did not run.
 * @returns The history, over the last days of the seeded window.
 */
function history(rates: readonly (number | null)[]): InsightsFlakyCase["history"] {
  return rates.map((ratePct, index) => ({ day: SEEDED_DAYS[SEEDED_DAYS.length - rates.length + index]!, ratePct }));
}

/**
 * One flaky case.
 *
 * @param over What differs from the seeded fixed case.
 * @returns The case.
 */
export function flakyCase(over: Partial<InsightsFlakyCase> = {}): InsightsFlakyCase {
  return {
    caseKey: "tests/telemetry/test_frame_order.c",
    name: null,
    suite: "telemetry integration",
    repository: "acme/helios-firmware",
    state: "fixed",
    ratePct: 0,
    trend: "falling",
    history: history([7, 8, 6, 7.5, 5, 6.5, 4, 3, 2, 0, 0, 0]),
    resolvedBy: { runId: FIXING_RUN_ID, issueNumber: 1847 },
    ...over,
  };
}

/** Mockup 15's three flaky rows — fixed, quarantined on a rig, and watching. */
export function seededFlaky(): InsightsPage["flaky"] {
  return {
    cases: [
      flakyCase(),
      withoutResolved({
        caseKey: "tests/hil/test_estop_release.py",
        suite: "physical · HIL",
        state: "quarantined",
        ratePct: 4.1,
        trend: "rising",
        history: history([1, 1.5, 1, 2, 2, 3, 2.5, 3.5, 3, 4.5, 5, 6]),
        platform: "rig:hil-rig-02",
      }),
      withoutResolved({
        caseKey: "tests/ota/test_swap.c",
        suite: "OTA update",
        state: "watching",
        ratePct: 1.2,
        trend: "flat",
        history: history([1, 1.5, 1, 1, 2, 1.5, 1, 2.5, 2, 2.5, null, 3]),
      }),
    ],
  };
}

/**
 * A case that is not `fixed` — the seeded case with `over` applied and no `resolvedBy` key, as the
 * service omits it.
 *
 * @param over What differs from the seeded case.
 * @returns The case.
 */
export function withoutResolved(over: Partial<InsightsFlakyCase>): InsightsFlakyCase {
  const flaky = flakyCase(over);

  delete flaky.resolvedBy;

  return flaky;
}

/** The seeded workspace's *Flaky test hunt* recipe (mockup 14). */
export const SEEDED_PLAYBOOK: FlakyPlaybook = { id: "5eed0000-0000-4000-8000-00000000f1a7", name: "Flaky test hunt" };

/**
 * One scoreboard row.
 *
 * @param over What differs from the seeded primary `implement` row.
 * @returns The row.
 */
export function scoreRow(over: Partial<ScoreboardRow> = {}): ScoreboardRow {
  return {
    taskKind: "implement",
    model: "claude-fable-5",
    hop: 1,
    role: "primary",
    merged: 50,
    untouched: 42,
    untouchedRate: 84,
    cost: { pricing: "priced", cents: 4350, centsPerSuccess: 87 },
    trend: { direction: "up", prior: 80, delta: 4 },
    lowSample: false,
    ...over,
  };
}

/**
 * Mockup 15's scoreboard — the four rows, no suggestion (AB.3 does not exist yet).
 *
 * @param over What differs.
 * @returns The scoreboard.
 */
export function seededScoreboard(over: Partial<Scoreboard> = {}): Scoreboard {
  return {
    range: "30d",
    window: { from: "2026-07-10", to: "2026-08-08" },
    prior: { from: "2026-06-10", to: "2026-07-09" },
    minSample: 5,
    rows: [
      scoreRow(),
      scoreRow({
        model: "copilot/gpt-5-codex",
        hop: 2,
        role: "fallback",
        merged: 18,
        untouched: 11,
        untouchedRate: 61,
        cost: { pricing: "priced", cents: 1692, centsPerSuccess: 94 },
        trend: { direction: "down", prior: 66, delta: -5 },
      }),
      scoreRow({
        taskKind: "docs",
        model: "ollama/qwen3-coder",
        merged: 25,
        untouched: 24,
        untouchedRate: 96,
        cost: { pricing: "priced", cents: 0, centsPerSuccess: 0 },
        trend: { direction: "flat", prior: null, delta: null },
      }),
      scoreRow({
        taskKind: "review",
        merged: 3,
        untouched: 3,
        untouchedRate: 100,
        cost: { pricing: "unpriced", tokens: 123_600, unpricedTokens: 123_600, tokensPerSuccess: 41_200 },
        trend: { direction: "up", prior: 88, delta: 12 },
        lowSample: true,
      }),
    ],
    methodology: {
      untouched: methodology({ metricId: "merged_untouched_rate", title: "Merged w/o human edits", formula: I6_FORMULA }),
      costPerSuccess: methodology({
        metricId: "cost_per_success",
        title: "$ / success",
        unit: "cents",
        formula: COST_PER_SUCCESS_FORMULA,
      }),
      trend: methodology({ metricId: "scoreboard_trend", title: "Trend" }),
      sample: methodology({ metricId: "scoreboard_sample", title: "Sample", unit: "count" }),
    },
    ...over,
  };
}

/** One DORA cell, as served (#447). */
export type DoraCellFixture = InsightsPage["dora"][number];

/** The registry's change-failure-rate caveat — a proxy, and says so. */
export const CFR_CAVEAT = "A proxy: revert detection only. A failure fixed forward rather than reverted is not counted.";

/** The registry's MTTR caveat — a proxy, and says so. */
export const MTTR_CAVEAT = "A proxy: loop-scoped recovery, not production incidents. Re-windowed from total time over count.";

/** The registry's deploy-frequency caveat — what stands in for a deploy. */
export const DEPLOY_CAVEAT =
  "A green default-branch build stands in for a deploy; pipelines that deploy elsewhere are not seen.";

/**
 * One DORA cell.
 *
 * @param over What differs.
 * @returns The cell.
 */
export function doraCell(over: Partial<DoraCellFixture> = {}): DoraCellFixture {
  return {
    key: "deploy_frequency",
    unit: "per_day",
    value: 4.2,
    prior: 3.8,
    delta: 0.4,
    trend: { direction: "up", good: true },
    sparkline: SEEDED_DAYS.map((_, index) => 2 + (index % 5)),
    proxy: false,
    methodology: methodology({
      metricId: "deploy_frequency",
      title: "Deploy frequency",
      formula: "Successful default-branch builds on the build farm per day.",
      sources: ["builds"],
      caveats: DEPLOY_CAVEAT,
      unit: "count",
      aggregation: "sum",
    }),
    ...over,
  };
}

/**
 * The seeded DORA strip — mockup 15's `4.2/day ▲`, `3h 10m ▼`, `3.1% —`, `22m ▼`.
 *
 * @returns The four cells, in strip order.
 */
export function seededDora(): DoraCellFixture[] {
  return [
    doraCell(),
    doraCell({
      key: "lead_time",
      unit: "duration_ms",
      value: 11_400_000,
      prior: 12_600_000,
      delta: -1_200_000,
      trend: { direction: "down", good: true },
      methodology: methodology({
        metricId: "lead_time",
        title: "Lead time",
        formula: "Mean time from a loop starting on an issue to its pull request merging.",
        sources: ["runs", "pull_requests"],
        caveats: "Time before the loop picked the issue up is not included.",
        unit: "duration_ms",
        aggregation: "ratio",
      }),
    }),
    doraCell({
      key: "change_failure_rate",
      unit: "pct",
      value: 3.1,
      prior: 3.1,
      delta: 0,
      trend: { direction: "flat", good: null },
      proxy: true,
      methodology: methodology({
        metricId: "change_failure_rate",
        title: "Change failure rate",
        formula: "Merged pull requests later reverted, divided by merged pull requests.",
        sources: ["pull_requests"],
        caveats: CFR_CAVEAT,
        unit: "pct",
        proxy: true,
        aggregation: "ratio",
      }),
    }),
    doraCell({
      key: "mttr",
      unit: "duration_ms",
      value: 1_320_000,
      prior: 1_800_000,
      delta: -480_000,
      trend: { direction: "down", good: true },
      proxy: true,
      methodology: methodology({
        metricId: "mttr",
        title: "MTTR",
        formula: "Mean time from a loop's build or test failure to the same loop's next green.",
        sources: ["runs", "builds"],
        caveats: MTTR_CAVEAT,
        unit: "duration_ms",
        proxy: true,
        aggregation: "ratio",
      }),
    }),
  ];
}

/** Rollups filled through yesterday, two minutes before the read — a current page (#447). */
export const CURRENT_FRESHNESS: InsightsPage["freshness"] = {
  filledThrough: "2026-08-07",
  lastFilledAt: "2026-08-08T14:00:00.000Z",
  behind: false,
  failing: false,
};

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
    hbars: {
      interventions: seededInterventions(),
      stages: seededStages(),
      suites: seededSuites(),
      effort: seededEffort(),
      tokens: seededTokens(),
    },
    performance: seededPerformance(),
    flaky: seededFlaky(),
    scoreboard: seededScoreboard(),
    dora: seededDora(),
    freshness: CURRENT_FRESHNESS,
    ...over,
  } as InsightsPage;
}

/**
 * What the route reads for the first paint.
 *
 * @param page The page, or `null` for a read that failed.
 * @param range The range it was read for. Defaults to the page's own.
 * @param mayRecategorize Whether the reader is a member or above. Defaults to `true`.
 * @param flakyPlaybook The flaky-test recipe reading (#446). Defaults to the seeded recipe.
 * @returns The readings.
 */
export function insightsReadings(
  page: InsightsPage | null = seededInsights(),
  range: InsightsRange = page?.range ?? "30d",
  mayRecategorize = true,
  flakyPlaybook: InsightsReadings["flakyPlaybook"] = { ok: true, value: SEEDED_PLAYBOOK },
): InsightsReadings {
  return {
    range,
    page: page === null ? { ok: false, reason: "Choose a workspace." } : { ok: true, value: page },
    readAt: INSIGHTS_READ_AT,
    mayRecategorize,
    flakyPlaybook,
  };
}
