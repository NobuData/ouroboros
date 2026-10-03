import type {
  AnalysisEvidence,
  AnalysisRun,
  AnalysisSchedule,
  AnalyzerProgress,
  ChangePoint,
  ChangePointCandidate,
  DurationChart,
} from "@/app/api/analyzer";
import type { AnalyzerPage } from "@/app/analyzer/analyzer-poll";
import type { AnalyzerReadings } from "@/app/analyzer/data";
import type { AnalyzerRepo } from "@/app/analyzer/repo";
import type { PollAnswer } from "@/app/poll";

import { seededSuggestions } from "./analyzer-suggestions";

/**
 * The Build Analyzer's fixtures (#516) — the dev seed's run and schedule for
 * `acme-robotics/helios-firmware` (`R__dev_seed_workspace_metrics_analyzer.sql`): 1,284 builds,
 * 312 loops, 4.1M log lines sampled at 0.3 under `max_log_lines`, 62 HIL sessions, seven
 * deterministic analyzers, 41 minutes, no LLM spend, weekly on Monday at 06:00 UTC + every 50.
 *
 * And its duration chart (#517): the eighty-nine daily medians of `zephyr build` and the three
 * change-points `GET /api/v1/analyzer/duration` answers over that seed — transcribed from the
 * service's own answer, dated for the day these fixtures stand on ({@link ANALYZER_NOW}), so
 * mockup 18's May 18, Jun 22 and Jul 30 (82, 47 and 9 days before its *today*) are Jul 12, Aug 16
 * and Sep 23 here.
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

/** The seeded series' daily medians, in seconds, oldest first: 252 → 342 → 212 → 252 with its wobble. */
const SEEDED_MEDIANS: readonly number[] = [
  252, 256, 248, 252, 259, 245, 252, 342, 352, 337, 342, 347, 333, 342, 351, 336, 342, 348, 331, 342,
  353, 338, 342, 346, 335, 342, 349, 332, 342, 352, 337, 342, 347, 333, 342, 351, 336, 342, 348, 331,
  342, 342, 212, 216, 208, 212, 219, 205, 212, 222, 202, 212, 217, 207, 212, 221, 203, 212, 218, 206,
  212, 223, 201, 212, 216, 208, 212, 219, 205, 212, 222, 202, 212, 217, 207, 212, 221, 203, 212, 212,
  252, 263, 241, 252, 256, 248, 252, 259, 245,
];

/** How many builds each of those medians is over. */
const SEEDED_BUILDS: readonly number[] = [
  9, 8, 2, 3, 10, 8, 13, 10, 4, 3, 10, 13, 12, 10, 10, 5, 3, 12, 10, 13, 12, 10, 4, 3, 11, 12, 9, 13,
  11, 5, 4, 11, 12, 10, 12, 11, 4, 3, 10, 12, 12, 11, 12, 3, 4, 11, 10, 12, 12, 11, 3, 5, 12, 12, 10,
  13, 3, 4, 11, 12, 4, 9, 11, 9, 10, 9, 4, 4, 9, 10, 12, 9, 10, 2, 5, 9, 8, 10, 12, 9, 3, 4, 12, 14,
  10, 12, 5, 7, 11,
];

/** The seeded series' first day: the rollup starts the day after the run's window opens. */
const SEEDED_FIRST_DAY = Date.parse("2026-07-05T00:00:00.000Z");

/**
 * The day at an index of the seeded series.
 *
 * @param index The point's index; `0` is Jul 5.
 * @returns The ISO date.
 */
export function seededDay(index: number): string {
  return new Date(SEEDED_FIRST_DAY + index * 86_400_000).toISOString().slice(0, 10);
}

/** The analyzer's documented confidence rule, as every v1 change-point stores it. */
const CHANGE_POINT_METHOD =
  "change_point v1: 100 * stability * (1 - e^(-effect/2)) * min(1, shorter segment days / (2 * min_segment_days))";

/**
 * One piece of resolved evidence.
 *
 * @param kind Its kind.
 * @param id Its id — a commit sha for a merge.
 * @param label What it names.
 * @param over Anything else — a PR, a workflow.
 * @returns The evidence, opening on the farm unless told otherwise.
 */
export function evidenceOf(
  kind: AnalysisEvidence["kind"],
  id: string,
  label: string | null,
  over: Partial<AnalysisEvidence> = {},
): AnalysisEvidence {
  return {
    kind,
    id,
    label,
    surface: label === null ? null : "farm",
    pullRequestId: null,
    workflowSlug: null,
    runId: null,
    attempt: null,
    suiteName: null,
    caseName: null,
    ...over,
  };
}

/**
 * One ranked candidate of a change-point.
 *
 * @param breakpoint The index of the change-point's day in the seeded series.
 * @param label Its label.
 * @param eventKind What kind of change it is.
 * @param offset Days from the breakpoint.
 * @param prior The kind's prior; the score is `proximity × prior`.
 * @param ref The evidence it cites.
 * @returns The candidate, scored as `ChangePointAnalyzer` v1 scores one (±3-day window).
 */
function candidateOf(
  breakpoint: number,
  label: string,
  eventKind: string,
  offset: number,
  prior: number,
  ref: ChangePointCandidate["ref"],
): ChangePointCandidate {
  const proximity = 1 - Math.abs(offset) / 4;

  return {
    label,
    score: Math.round(proximity * prior * 10_000) / 10_000,
    eventKind,
    date: seededDay(breakpoint + offset),
    daysFromBreakpoint: offset,
    proximity,
    prior,
    ref,
  };
}

/** The seeded workflow versions' ids — `standard-fix` v5 and v9. */
const STANDARD_FIX_V5 = "5eed001c-0000-4000-8000-010000000005";
const STANDARD_FIX_V9 = "5eed001c-0000-4000-8000-010000000009";

/** The seeded `pool-a`. */
const POOL_A = "5eed0024-0000-4000-8000-000000000001";

/** The three seeded merges the chips name, by the commit each landed as. */
const ZEPHYR_SHA = "63863e5cd395664116bdfc58edf1902dfc40b58c";
const CCACHE_SHA = "d8cdc9341c99f8e778d787d92d105107526073fa";
const TWISTER_SHA = "6500e3c60ab293cfa76989a2d69a3510f2055988";

/**
 * The seed's three change-points — *Zephyr 4.1 migration +1m 30s*, *ccache enabled −2m 10s* and
 * *twister suite growth +40s* — each with its ranked candidates and resolved evidence, as the
 * service answers them. No seeded merge has a mirrored PR, so every merge opens on the farm.
 *
 * @returns The change-points, oldest first.
 */
export function seededChangePoints(): ChangePoint[] {
  const merge = (sha: string) => ({ kind: "merge", id: sha });
  const build = (n: number) => evidenceOf("build", `5eed0062-0000-4000-8000-0000000${n}`, `#${n} · zephyr build`);
  const point = (
    n: number,
    index: number,
    deltaSeconds: number,
    before: number,
    basis: [confidence: number, sampleSize: number, effectSize: number],
    candidates: ChangePointCandidate[],
    evidence: AnalysisEvidence[],
  ): ChangePoint => ({
    id: `5eed0066-0000-4000-8000-00000000010${n}`,
    analyzerVersion: 1,
    date: seededDay(index),
    metric: "build.duration_median",
    deltaSeconds,
    beforeMedianSeconds: before,
    afterMedianSeconds: before + deltaSeconds,
    attributionWindowDays: 3,
    candidates,
    confidence: basis[0],
    confidenceBasis: { method: CHANGE_POINT_METHOD, sampleSize: basis[1], effectSize: basis[2], stability: 1 },
    evidence,
  });
  const docs = "728d3ab9e8af1f9d1cbda999dfe4f1ff589e5359";
  const can = "1ad1ba5cb805810baf727abc1e6c7d0eb94300eb";
  const later: readonly [string, string, number][] = [
    ["Motor PID: clamp the integral term on saturation", "4823b728890e1d10c3014d550603a51c9b70e8fe", 2],
    ["Tune the brown-out threshold for writes during flashing", "b97a46a836529d894943839c8b09880915d4e891", 2],
    ["Publish OTA progress events on the telemetry channel", "416316264991ef4e313cf8638e4e88d7a8abb4bb", 3],
    ["Refactor the telemetry buffer allocation", "999e8570b54b6ff2858220e1ba09a2269a96876e", 3],
  ];

  return [
    point(
      1,
      7,
      90,
      252,
      [70, 370, 12.141],
      [
        candidateOf(7, "Zephyr 4.1 migration", "merge", 0, 0.7, merge(ZEPHYR_SHA)),
        candidateOf(7, "pool-a image zephyr-sdk:0.16", "infra_event", -2, 0.6, { kind: "runner_pool", id: POOL_A }),
        candidateOf(7, "standard-fix v5", "policy_version", -2, 0.4, { kind: "workflow_version", id: STANDARD_FIX_V5 }),
        candidateOf(7, "docs: README typo", "merge", 3, 0.7, merge(docs)),
      ],
      [
        evidenceOf("merge", ZEPHYR_SHA, "Zephyr 4.1 migration"),
        evidenceOf("runner_pool", POOL_A, "pool-a"),
        evidenceOf("workflow_version", STANDARD_FIX_V5, "standard-fix v5", {
          surface: "workflow",
          workflowSlug: "standard-fix",
        }),
        evidenceOf("merge", docs, "docs: README typo"),
        build(10100),
        build(10102),
      ],
    ),
    point(
      2,
      42,
      -130,
      342,
      [100, 642, 17.537],
      [
        candidateOf(42, "ccache enabled", "merge", 0, 0.7, merge(CCACHE_SHA)),
        candidateOf(42, "can: driver timeout tweak", "merge", -1, 0.7, merge(can)),
        candidateOf(42, "standard-fix v9", "policy_version", -1, 0.4, { kind: "workflow_version", id: STANDARD_FIX_V9 }),
      ],
      [
        evidenceOf("merge", CCACHE_SHA, "ccache enabled"),
        evidenceOf("merge", can, "can: driver timeout tweak"),
        evidenceOf("workflow_version", STANDARD_FIX_V9, "standard-fix v9", {
          surface: "workflow",
          workflowSlug: "standard-fix",
        }),
        build(10623),
        build(10625),
      ],
    ),
    point(
      3,
      80,
      40,
      212,
      [84, 403, 5.396],
      [
        candidateOf(80, "twister suite growth", "merge", 0, 0.7, merge(TWISTER_SHA)),
        ...later.map(([label, sha, offset]) => candidateOf(80, label, "merge", offset, 0.7, merge(sha))),
      ],
      [
        evidenceOf("merge", TWISTER_SHA, "twister suite growth"),
        ...later.map(([label, sha]) => evidenceOf("merge", sha, label)),
        build(11165),
        build(11167),
      ],
    ),
  ];
}

/**
 * The seeded duration chart — eighty-nine days of `zephyr build` medians under three
 * change-points — or a variant.
 *
 * @param over Fields to replace.
 * @returns The chart.
 */
export function seededDuration(over: Partial<DurationChart> = {}): DurationChart {
  return {
    repo: HELIOS,
    runId: "5eed0065-0000-4000-8000-000000000002",
    analyzedAt: "2026-10-02T18:00:00.000Z",
    durationLabel: "zephyr build",
    window: { from: "2026-07-04", to: "2026-10-01", days: 90 },
    series: SEEDED_MEDIANS.map((medianSeconds, index) => ({
      day: seededDay(index),
      medianSeconds,
      builds: SEEDED_BUILDS[index]!,
    })),
    changePoints: seededChangePoints(),
    ...over,
  };
}

/**
 * The chart of a repository no run has looked for change-points in.
 *
 * @param repo The repository.
 * @returns The empty chart.
 */
export function emptyDuration(repo: string = HELIOS): DurationChart {
  return {
    repo,
    runId: null,
    analyzedAt: null,
    durationLabel: null,
    window: null,
    series: [],
    changePoints: [],
  };
}

/**
 * One repository's page.
 *
 * @param over Fields to replace.
 * @returns The page.
 */
export function analyzerPage(over: Partial<AnalyzerPage> = {}): AnalyzerPage {
  return {
    repo: HELIOS,
    run: seededRun(),
    schedule: seededSchedule(),
    duration: seededDuration(),
    suggestions: seededSuggestions(),
    ...over,
  };
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
    mayDismiss: true,
    readAt: ANALYZER_NOW,
    ...over,
  };
}
