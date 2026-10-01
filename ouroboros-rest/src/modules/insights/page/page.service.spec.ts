/**
 * The page's read (BJ.2, #438): which planes it asks, with what scope and what instant — and that
 * it computes nothing itself.
 */

import type { FlakeStateService } from "../../flakes/flake-state.service";
import type { CalibrationService } from "../calibration.service";
import type { MetricsService } from "../metrics/metrics.service";
import type { ScoreboardService } from "../scoreboard/scoreboard.service";
import {
  emptyScoreboard,
  flakyCase,
  mockupBreakdowns,
  mockupWeek,
  mockupWindows,
  quarterWith,
} from "./page.fixture";
import type { InsightsPageRepository } from "./page.repository";
import { DEFAULT_INSIGHTS_RANGE, InsightsPageService, PAGE_METRICS } from "./page.service";

const ORG = "org-insights";
const NOW = Date.parse("2026-08-08T14:00:00.000Z");

/** A page service over stand-ins answering mockup 15's facts. */
function build() {
  const breakdowns = mockupBreakdowns();
  const byMetric = {
    human_interventions: breakdowns.interventions,
    stage_duration: breakdowns.stages,
    test_failures_by_suite: breakdowns.suites,
    completion_time_by_effort: breakdowns.effort,
    tokens_by_task_kind: breakdowns.tokens,
  } as const;
  // Answered by what was asked for, not by the range: a 90-day page asks 90 days twice.
  const windows = jest.fn((ids: readonly string[], _scope: { range: string }) =>
    Promise.resolve(
      ids.includes("merge_rate")
        ? mockupWindows()
        : ids.includes("merged_prs")
          ? mockupWeek()
          : quarterWith(),
    ),
  );
  const breakdown = jest.fn((metricId: keyof typeof byMetric, _scope: { range: string }) =>
    Promise.resolve(byMetric[metricId]),
  );
  const scoreboard = jest.fn((_scope: { organizationId: string }) =>
    Promise.resolve(emptyScoreboard()),
  );
  const report = jest.fn().mockResolvedValue({ withinBandPct: (100 * 8) / 9 });
  const card = jest.fn((_organizationId: string, _span: object, _repo?: string) =>
    Promise.resolve([flakyCase()]),
  );
  const caps = jest.fn().mockResolvedValue({ monthlyCapCents: 60_000, connections: 2 });
  const service = new InsightsPageService(
    { windows, breakdown } as unknown as MetricsService,
    { scoreboard } as unknown as ScoreboardService,
    { report } as unknown as CalibrationService,
    { card } as unknown as FlakeStateService,
    { caps } as unknown as InsightsPageRepository,
    () => NOW,
  );

  return { service, windows, breakdown, scoreboard, report, card, caps };
}

describe("the insights page service", () => {
  it("opens on the mockup's active range", () => {
    expect(DEFAULT_INSIGHTS_RANGE).toBe("30d");
  });

  it("reads the head over a week, the page over its range, and the projection over a quarter", async () => {
    const { service, windows } = build();

    await service.read(ORG, { range: "30d" });

    expect(windows.mock.calls.map(([ids, scope]) => [scope.range, ids])).toEqual([
      ["7d", ["merged_prs", "human_interventions"]],
      ["30d", PAGE_METRICS],
      ["90d", ["tokens", "unpriced_tokens", "cost_cents"]],
    ]);
  });

  it("asks for every figure the composers draw, each once", () => {
    expect(new Set(PAGE_METRICS).size).toBe(PAGE_METRICS.length);
    expect([...PAGE_METRICS].sort()).toEqual(
      [
        "build_failures",
        "build_success_rate",
        "builds",
        "change_failure_rate",
        "cost_cents",
        "cost_per_merged_pr",
        "cycle_time",
        "deploy_frequency",
        "human_interventions",
        "lead_time",
        "local_tokens",
        "merge_rate",
        "merged_prs",
        "merged_untouched_rate",
        "mttr",
        "test_cases_run",
        "test_pass_rate",
        "tokens",
        "unpriced_tokens",
      ].sort(),
    );
  });

  it("breaks out the five bar cards through the metrics service — no query of its own", async () => {
    const { service, breakdown } = build();

    await service.read(ORG, { range: "90d" });

    expect(breakdown.mock.calls.map(([metricId, scope]) => [metricId, scope.range])).toEqual([
      ["human_interventions", "90d"],
      ["stage_duration", "90d"],
      ["test_failures_by_suite", "90d"],
      ["completion_time_by_effort", "90d"],
      ["tokens_by_task_kind", "90d"],
    ]);
  });

  it("gives every read the same workspace, repository and instant", async () => {
    const { service, windows, breakdown, scoreboard, report, caps } = build();

    await service.read(ORG, { range: "30d", repo: "Acme-Robotics/Helios-Firmware" });

    const scopes = [
      ...windows.mock.calls.map(([, scope]) => scope),
      ...breakdown.mock.calls.map(([, scope]) => scope),
      ...scoreboard.mock.calls.map(([scope]) => scope),
    ] as { organizationId: string; repo?: string; now: Date }[];

    expect(scopes).toHaveLength(9);
    for (const scope of scopes) {
      expect(scope.organizationId).toBe(ORG);
      // The grain's repo_ref is lower-case, as the mirror stores it.
      expect(scope.repo).toBe("acme-robotics/helios-firmware");
      // One instant: a request across midnight cannot draw two different days.
      expect(scope.now).toEqual(new Date(NOW));
    }
    expect(report).toHaveBeenCalledWith(ORG, "30d");
    expect(caps).toHaveBeenCalledWith(ORG);
  });

  it("reads the flaky card over the same UTC days the charts cover", async () => {
    const { service, card } = build();

    await service.read(ORG, { range: "30d", repo: "acme-robotics/helios-firmware" });

    expect(card).toHaveBeenCalledWith(
      ORG,
      { from: new Date("2026-07-10T00:00:00.000Z"), to: new Date("2026-08-09T00:00:00.000Z") },
      "acme-robotics/helios-firmware",
    );
  });

  it("reads the whole workspace when no repository is named", async () => {
    const { service, windows, card } = build();

    const page = await service.read(ORG, { range: "30d" });

    expect(windows.mock.calls[1][1]).toMatchObject({ organizationId: ORG, repo: undefined });
    expect(card.mock.calls[0][2]).toBeUndefined();
    expect(page.repo).toBeNull();
  });

  it("answers the composed payload", async () => {
    const page = await build().service.read(ORG, { range: "30d" });

    expect(page).toMatchObject({
      range: "30d",
      head: { mergedPrs: 27, interventions: 2 },
      usage: { pricing: "priced" },
      series: { cost: { budget: { monthlyCapCents: 60_000 } } },
      hbars: { interventions: { line: "Fix the top row and interventions drop ~40%." } },
      flaky: { cases: [{ state: "quarantined", ratePct: 4 }] },
    });
  });

  it("uses the wall clock when no clock is bound", async () => {
    const { windows, breakdown, scoreboard, report, card, caps } = build();
    const service = new InsightsPageService(
      { windows, breakdown } as unknown as MetricsService,
      { scoreboard } as unknown as ScoreboardService,
      { report } as unknown as CalibrationService,
      { card } as unknown as FlakeStateService,
      { caps } as unknown as InsightsPageRepository,
    );
    const before = Date.now();

    await service.read(ORG, { range: "7d" });

    const { now } = windows.mock.calls[0][1] as unknown as { now: Date };

    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
