/**
 * A week of Insights for the digest's suites (#440) — the page's own fixture
 * (`page/page.fixture.ts`), re-cut to seven days.
 *
 * **The digest is tested through the page.** Every case here builds `PageFacts`, runs them
 * through the page's real composer (`insightsResource`), and hands *that* payload to
 * `assembleDigest` — so a digest spec can only see what the page answers, the same way the
 * running digest can. The week's figures are the roadmap's example line:
 * *"27 merged · 92% autonomous (▲3) · top cause: flaky rig (8) · $118 this week"*.
 */

import type { FlakeCardCase } from "../../flakes/flakes.resources";
import type { MetricWindow } from "../metrics/metrics.types";
import { insightsResource, type PageFacts } from "../page/page.compose";
import {
  breakdownOf,
  daysEnding,
  emptyScoreboard,
  flakyCase,
  mockupBreakdowns,
  pageWindow,
  quarterWith,
  windowsOf,
  type WindowOptions,
} from "../page/page.fixture";
import type { InsightsResource } from "../page/page.resources";
import { assembleDigest, type DigestAssembly } from "./digest.assembly";
import type { DigestContext } from "./digest.copy";

/** The fixture week's seven UTC days: Aug 2 – Aug 8. */
export const WEEK = daysEnding(7);

/** Who the fixture digest is rendered for. */
export const DIGEST_CONTEXT: DigestContext = {
  workspaceName: "Acme Robotics",
  insightsUrl: "https://ouroboros.acme.dev/insights?range=7d",
  unsubscribeUrl:
    "https://api.ouroboros.acme.dev/api/v1/insights/digest/unsubscribe/ouro_unsub_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};

/**
 * A metric's window over the fixture week.
 *
 * @param metricId - The metric.
 * @param options - Its figures.
 * @returns The seven-day window.
 */
export function weekWindow(metricId: string, options: WindowOptions = {}): MetricWindow {
  return pageWindow(metricId, { ...options, days: WEEK, range: "7d" });
}

/** The week's undimensioned figures. */
export function weekWindows(): Map<string, MetricWindow> {
  const rate = { unit: "pct", aggregation: "ratio", fill: null } as const;

  return windowsOf(
    weekWindow("merge_rate", {
      ...rate,
      value: (100 * 24) / 26,
      prior: 89.3,
      components: { numerator: 24, denominator: 26 },
    }),
    weekWindow("merged_untouched_rate", {
      ...rate,
      value: (100 * 21) / 27,
      prior: 75,
      components: { numerator: 21, denominator: 27 },
    }),
    weekWindow("cycle_time", {
      value: 860_000,
      prior: 980_000,
      unit: "duration_ms",
      aggregation: "median",
      fill: null,
    }),
    weekWindow("cost_per_merged_pr", {
      value: 11_800 / 27,
      prior: 478,
      components: { numerator: 11_800, denominator: 27 },
      unit: "cents",
      aggregation: "ratio",
      fill: null,
    }),
    weekWindow("human_interventions", { value: 12, prior: 9, fill: 2 }),
    weekWindow("merged_prs", { value: 27, prior: 22, fill: 4 }),
    weekWindow("tokens", { value: 31_000_000, prior: 35_000_000, unit: "tokens", fill: 4_400_000 }),
    weekWindow("unpriced_tokens", { value: 0, prior: 0, unit: "tokens" }),
    weekWindow("cost_cents", { value: 11_800, prior: 13_900, unit: "cents", fill: 1_686 }),
    weekWindow("local_tokens", { value: 9_600_000, unit: "tokens", fill: 1_370_000 }),
    weekWindow("builds", { value: 96, prior: 90, fill: 14 }),
    weekWindow("build_failures", { value: 8, prior: 9, fill: 1 }),
    weekWindow("build_success_rate", {
      ...rate,
      value: (100 * 88) / 96,
      prior: 90,
      components: { numerator: 88, denominator: 96 },
    }),
    weekWindow("test_cases_run", { value: 6_170, prior: 5_900, fill: 881 }),
    weekWindow("test_pass_rate", {
      ...rate,
      value: (100 * 6_162) / 6_170,
      prior: 99.8,
      components: { numerator: 6_162, denominator: 6_170 },
    }),
    weekWindow("deploy_frequency", { value: 29, prior: 25, fill: 4 }),
    weekWindow("lead_time", { ...rate, value: 1_680_000, prior: 2_058_000, unit: "duration_ms" }),
    weekWindow("change_failure_rate", { ...rate, value: 3.1, prior: 3.1, proxy: true }),
    weekWindow("mttr", {
      ...rate,
      value: 1_320_000,
      prior: 1_680_000,
      unit: "duration_ms",
      proxy: true,
    }),
  );
}

/** A case that was fixed this week, by a loop the occurrences name. */
export function fixedCase(): FlakeCardCase {
  return flakyCase({
    caseKey: "b".repeat(64),
    name: "tests/hil/test_estop_release.py",
    state: "fixed",
    observed: 12,
    flaky: 1,
    history: [
      { day: WEEK[0], observed: 6, flaky: 1 },
      { day: WEEK[5], observed: 6, flaky: 0 },
    ],
    platform: null,
    resolvedBy: { runId: "run-1847", issueNumber: 1847 },
  });
}

/** A watched case whose flake rate rose inside the week, on one platform. */
export function risingCase(): FlakeCardCase {
  return flakyCase({
    caseKey: "c".repeat(64),
    name: "ring buffer drains under burst",
    suite: "telemetry integration",
    state: "watching",
    observed: 20,
    flaky: 5,
    history: [
      { day: WEEK[1], observed: 10, flaky: 1 },
      { day: WEEK[5], observed: 10, flaky: 4 },
    ],
    platform: "qemu_cortex_m3",
    resolvedBy: null,
  });
}

/** A case quarantined long ago that did not run this week — not this week's news. */
export function idleCase(): FlakeCardCase {
  return flakyCase({ observed: 0, flaky: 0, history: [] });
}

/**
 * Everything the seven-day page is composed from.
 *
 * @param overrides - What a case changes.
 * @returns The facts.
 */
export function weekFacts(overrides: Partial<PageFacts> = {}): PageFacts {
  const windows = weekWindows();

  return {
    range: "7d",
    repo: null,
    week: windowsOf(
      weekWindow("merged_prs", { value: 27, prior: 22, fill: 4 }),
      weekWindow("human_interventions", { value: 12, prior: 9, fill: 2 }),
    ),
    windows,
    quarter: quarterWith(),
    breakdowns: {
      ...mockupBreakdowns(),
      interventions: breakdownOf("human_interventions", "cause", [
        ["infra_rig", 8, 4],
        ["ambiguous_ticket", 3, 4],
        ["policy_gate", 1, 1],
      ]),
    },
    calibration: { withinBandPct: (100 * 8) / 9 },
    caps: { monthlyCapCents: 60_000, connections: 2 },
    flaky: [fixedCase(), risingCase(), idleCase()],
    scoreboard: emptyScoreboard(),
    ...overrides,
  };
}

/**
 * The facts with some windows replaced.
 *
 * @param facts - The facts.
 * @param replaced - The replacements.
 * @returns New facts.
 */
export function withWeekWindows(facts: PageFacts, ...replaced: MetricWindow[]): PageFacts {
  return {
    ...facts,
    windows: new Map([...facts.windows, ...replaced.map((w) => [w.metricId, w] as const)]),
  };
}

/** A week in which a quarter of the tokens have no price. */
export function partlyPricedWeekFacts(): PageFacts {
  return withWeekWindows(
    weekFacts(),
    weekWindow("unpriced_tokens", { value: 7_750_000, unit: "tokens", fill: 1_100_000 }),
  );
}

/** A week nothing prices: every token unpriced, and no cost row at all. */
export function unpricedWeekFacts(): PageFacts {
  return withWeekWindows(
    weekFacts(),
    weekWindow("unpriced_tokens", { value: 31_000_000, unit: "tokens", fill: 4_400_000 }),
    weekWindow("cost_cents", { value: 0, prior: 0, unit: "cents" }),
    weekWindow("cost_per_merged_pr", {
      value: null,
      prior: null,
      unit: "cents",
      aggregation: "ratio",
      fill: null,
    }),
  );
}

/** A week with nothing in it — and one long-quarantined case that did not run. */
export function emptyWeekFacts(): PageFacts {
  const nothing = { value: null, prior: null, fill: null } as const;
  const rate = { ...nothing, unit: "pct", aggregation: "ratio" } as const;
  const duration = { ...nothing, unit: "duration_ms" } as const;

  return {
    ...weekFacts(),
    week: windowsOf(weekWindow("merged_prs"), weekWindow("human_interventions")),
    windows: windowsOf(
      weekWindow("merge_rate", rate),
      weekWindow("merged_untouched_rate", rate),
      weekWindow("cycle_time", { ...duration, aggregation: "median" }),
      weekWindow("cost_per_merged_pr", { ...nothing, unit: "cents", aggregation: "ratio" }),
      weekWindow("human_interventions"),
      weekWindow("merged_prs"),
      weekWindow("tokens", { unit: "tokens" }),
      weekWindow("unpriced_tokens", { unit: "tokens" }),
      weekWindow("cost_cents", { unit: "cents" }),
      weekWindow("local_tokens", { unit: "tokens" }),
      weekWindow("builds"),
      weekWindow("build_failures"),
      weekWindow("build_success_rate", rate),
      weekWindow("test_cases_run"),
      weekWindow("test_pass_rate", rate),
      weekWindow("deploy_frequency"),
      weekWindow("lead_time", { ...duration, aggregation: "ratio" }),
      weekWindow("change_failure_rate", { ...rate, proxy: true }),
      weekWindow("mttr", { ...duration, aggregation: "ratio", proxy: true }),
    ),
    breakdowns: {
      ...mockupBreakdowns(),
      interventions: breakdownOf("human_interventions", "cause", []),
    },
    flaky: [idleCase()],
  };
}

/**
 * The seven-day page for some facts, composed by the page's own composer.
 *
 * @param facts - The facts.
 * @returns The payload `GET /api/v1/insights?range=7d` would answer.
 */
export function weekPage(facts: PageFacts = weekFacts()): InsightsResource {
  return insightsResource(facts);
}

/**
 * The digest for some facts.
 *
 * @param facts - The facts.
 * @returns The assembly.
 */
export function weekDigest(facts: PageFacts = weekFacts()): DigestAssembly {
  return assembleDigest(weekPage(facts));
}

/** The four states a digest is rendered in, by name — the golden file's and the screenshots'. */
export const DIGEST_STATES = {
  priced: weekFacts,
  "partly-priced": partlyPricedWeekFacts,
  unpriced: unpricedWeekFacts,
  empty: emptyWeekFacts,
} as const;
