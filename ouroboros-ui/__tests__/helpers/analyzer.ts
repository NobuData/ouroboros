import type { AnalysisRun, AnalysisSchedule, AnalyzerProgress } from "@/app/api/analyzer";
import type { AnalyzerPage } from "@/app/analyzer/analyzer-poll";
import type { AnalyzerReadings } from "@/app/analyzer/data";
import type { AnalyzerRepo } from "@/app/analyzer/repo";
import type { PollAnswer } from "@/app/poll";

/**
 * The Build Analyzer's fixtures (#516) — the dev seed's run and schedule for
 * `acme-robotics/helios-firmware` (`R__dev_seed_workspace_metrics_analyzer.sql`): 1,284 builds,
 * 312 loops, 4.1M log lines sampled at 0.3 under `max_log_lines`, 62 HIL sessions, seven
 * deterministic analyzers, 41 minutes, no LLM spend, weekly on Monday at 06:00 UTC + every 50.
 */

/** The workspace the fixtures belong to — `__tests__/helpers/login.ts`'s. */
export const ANALYZER_WORKSPACE = "5eed0001-0000-4000-8000-000000000001";

/** The seeded repository. */
export const HELIOS = "acme-robotics/helios-firmware";

/** The workspace's enabled repositories, in the service's order. */
export const ANALYZER_REPOS: readonly AnalyzerRepo[] = [
  { id: "7f000001-0000-4000-8000-000000000001", ref: "acme-robotics/atlas-scheduler" },
  { id: "7f000003-0000-4000-8000-000000000001", ref: HELIOS },
];

/** The instant the strip is measured against: two hours after the seeded run finished. */
export const ANALYZER_NOW = Date.parse("2026-10-02T20:00:00.000Z");

/** The seed's seven analyzers, in the set's order, with the findings each wrote. */
const SEEDED_ANALYZERS: readonly [string, number][] = [
  ["change_point", 3],
  ["log_signature", 2],
  ["config_usage", 1],
  ["cache_window", 1],
  ["queue_correlation", 1],
  ["waiver_cite", 1],
  ["workflow_outcome", 2],
];

/**
 * One analyzer's progress entry.
 *
 * @param id The analyzer.
 * @param status Its state.
 * @param over Anything else.
 * @returns The entry.
 */
export function progressOf(
  id: string,
  status: AnalyzerProgress["status"],
  over: Partial<AnalyzerProgress> = {},
): AnalyzerProgress {
  return { id, version: 1, status, findings: null, elapsedSeconds: null, reason: null, ...over };
}

/**
 * The seeded run — complete, 41 minutes, two hours ago — or a variant.
 *
 * @param over Fields to replace.
 * @returns The run.
 */
export function seededRun(over: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: "5eed0065-0000-4000-8000-000000000002",
    repo: HELIOS,
    trigger: "every_n_builds",
    status: "complete",
    phase: "composing",
    progress: {
      analyzers: SEEDED_ANALYZERS.map(([id, findings]) => progressOf(id, "completed", { findings })),
    },
    manifest: {
      window: { from: "2026-07-04", to: "2026-10-01", days: 90 },
      counts: { builds: 1284, loops: 312, logLines: 4_100_000, hilSessions: 62 },
      sources: {
        builds: { sampled: false, rate: 1, cap: null },
        loops: { sampled: false, rate: 1, cap: null },
        logLines: { sampled: true, rate: 0.3, cap: "maxLogLines" },
        hilSessions: { sampled: false, rate: 1, cap: null },
      },
      budget: { maxBuilds: 2000, maxLogLines: 1_230_000, computeCeilingSeconds: 3600 },
      durationLabel: null,
      absent: [],
      analyzers: null,
      confidence: {
        level: "high",
        windowDays: 90,
        builds: 1284,
        daysWithBuilds: 89,
        coverage: 0.9889,
        perDay: 14.2667,
        rule: { high: { coverage: 0.9, perDay: 5 }, medium: { coverage: 0.6, perDay: 1 } },
      },
    },
    analyzerSet: {
      label: "deterministic analyzers v1",
      analyzers: SEEDED_ANALYZERS.map(([id]) => ({ id, version: 1, kind: "deterministic" as const })),
    },
    startedAt: "2026-10-02T17:19:00.000Z",
    finishedAt: "2026-10-02T18:00:00.000Z",
    computeSeconds: 2460,
    llmCostCents: null,
    confidenceNote: "high — 90d of stable telemetry",
    failureReason: null,
    ...over,
  };
}

/**
 * A run in flight — `analyzing`, with the first analyzers done.
 *
 * @param over Fields to replace.
 * @returns The run.
 */
export function runningRun(over: Partial<AnalysisRun> = {}): AnalysisRun {
  return seededRun({
    id: "8c14647a-6139-476d-ba49-76545ffb5aec",
    trigger: "manual",
    status: "running",
    phase: "analyzing",
    progress: {
      analyzers: [
        progressOf("change_point", "completed", { findings: 3 }),
        progressOf("log_signature", "running"),
        progressOf("config_usage", "pending"),
      ],
    },
    startedAt: "2026-10-02T19:56:00.000Z",
    finishedAt: null,
    computeSeconds: 0,
    confidenceNote: null,
    ...over,
  });
}

/**
 * The seeded schedule — weekly on Monday at 06:00 UTC and every 50 builds, 12 counted so far.
 *
 * @param over Fields to replace.
 * @returns The schedule.
 */
export function seededSchedule(over: Partial<AnalysisSchedule> = {}): AnalysisSchedule {
  return {
    repo: HELIOS,
    saved: true,
    enabled: true,
    weeklyEnabled: true,
    weeklyDay: 1,
    weeklyTime: "06:00",
    everyNBuilds: 50,
    buildCounter: 12,
    maxBuilds: 2000,
    maxLogLines: 1_230_000,
    computeCeilingSeconds: 3600,
    ...over,
  };
}

/**
 * One repository's page.
 *
 * @param over Fields to replace.
 * @returns The page.
 */
export function analyzerPage(over: Partial<AnalyzerPage> = {}): AnalyzerPage {
  return { repo: HELIOS, run: seededRun(), schedule: seededSchedule(), ...over };
}

/**
 * A fresh poll answer carrying one page.
 *
 * @param page The page.
 * @returns The answer.
 */
export function freshPage(page: AnalyzerPage = analyzerPage()): PollAnswer<AnalyzerPage> {
  return { state: "fresh", payload: page, etag: null, pollAfterSeconds: null };
}

/**
 * What the route reads for the first paint.
 *
 * @param over Fields to replace.
 * @returns The readings — an administrator, both repositories enabled.
 */
export function analyzerReadings(over: Partial<AnalyzerReadings> = {}): AnalyzerReadings {
  return {
    repos: { ok: true, value: ANALYZER_REPOS },
    workspaceId: ANALYZER_WORKSPACE,
    mayAdminister: true,
    readAt: ANALYZER_NOW,
    ...over,
  };
}
