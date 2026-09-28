/**
 * What the test-results reads answer with, and the mapping from rows (AT.5,
 * [#333](https://github.com/NobuData/ouroboros/issues/333)).
 *
 * **The page renders what it is told.** Every figure mockup 11 prints — `63 · across 5 suites`,
 * `61 · ▲ 12 vs build 1`, `6m 12s · 4m sim · 2m 12s physical`, `87.4% (+0.6%)`, `retained 30d` —
 * is a field here, so a second surface rendering the same attempt cannot drift from the first.
 * A client formats; it derives nothing.
 *
 * **No storage detail leaves this file.** An artifact is its name, kind, size, checksum and an
 * `href` to the download route — never its `storage_ref`, its driver or its key.
 */

import type {
  FlakeState,
  HilLimitKind,
  HilVerdict,
  TestArtifactKind,
  TestAttemptOutcome,
  TestCaseStatus,
  TestRunStatus,
  TestSelectionScope,
  TestSuiteKind,
  TestSuiteResultsFormat,
} from "../db/schema";
import type { ParseWarning } from "../test-results/parser.spi";
import type { ClassificationResource } from "../triage/triage.resources";
import { isPreviewable } from "./artifact.serving";
import type {
  ArtifactRow,
  AttemptRow,
  CaseRow,
  CoverageRow,
  FlakeRow,
  MeasurementRow,
  RunRow,
  SuiteRow,
} from "./results.repository";
import {
  passedDelta,
  retentionDays,
  type ActivationState,
  type DeltaAttempt,
  type PassedDelta,
} from "./results.strip";

/** The path every artifact is downloaded from. */
export const ARTIFACT_PATH = "/api/v1/artifacts";

/** The prefix that makes a platform a physical rig (V051). */
const RIG_PREFIX = "rig:";

// --- the strip ------------------------------------------------------------------------------

/** A failing case, as the *Failed* stat's caption names it. */
export interface StripCaseResource {
  readonly caseId: string;
  readonly name: string;
  readonly suite: string;
  /** Ran on a rig — the caption's `· HIL`. */
  readonly physical: boolean;
}

/** A flaky case, as the *Flaky* stat's caption names it: `passed on retry 2/3 · watching`. */
export interface StripFlakyCaseResource extends StripCaseResource {
  /** The retry it passed on — the `2` of `2/3`. */
  readonly passedOnRetry: number;
  /** Every attempt it took — the `3` of `2/3`. */
  readonly attempts: number;
  /** Its flake score's state, or null when it has never been scored. */
  readonly flakeState: FlakeState | null;
}

/** The wall-time split — `6m 12s · 4m sim · 2m 12s physical`. All three or none (V051). */
export interface WallTimeResource {
  readonly wallMs: number;
  readonly simMs: number;
  readonly physicalMs: number;
}

/** The five stat cards of one attempt. */
export interface StripResource {
  readonly total: number;
  /** The suites the total spans — `across 5 suites`. */
  readonly suiteCount: number;
  readonly passed: number;
  /** `▲ 12 vs build 1`, or null when the count has not moved since the first report. */
  readonly passedDelta: PassedDelta | null;
  /** Cases that failed or errored. */
  readonly failed: number;
  readonly failedCases: readonly StripCaseResource[];
  readonly flaky: number;
  readonly flakyCases: readonly StripFlakyCaseResource[];
  readonly skipped: number;
  /** Null until the attempt reports a duration. */
  readonly wallTime: WallTimeResource | null;
}

// --- attempts and the timeline -------------------------------------------------------------

/** The build that produced an attempt. */
export interface AttemptBuildResource {
  readonly jobId: string;
  /** `#479`. Null once the job is pruned. */
  readonly number: number | null;
  readonly runner: string | null;
}

/** One attempt — Build 1 · 2 · 3. */
export interface AttemptResource {
  readonly id: string;
  readonly attemptSeq: number;
  readonly status: TestRunStatus;
  readonly commitSha: string | null;
  readonly startedAt: string;
  /**
   * When a report for this attempt last arrived — `test_runs.updated_at`, which every results
   * write moves. What the page's ingest-lag banner names (#342).
   */
  readonly lastReceivedAt: string;
  /** `failed` for *re-run of failed set*, `full` for a full re-run; null for an ordinary build. */
  readonly selection: TestSelectionScope | null;
  readonly build: AttemptBuildResource | null;
  /** The rigs its physical suites ran on — `helios-rig-02`. */
  readonly rigs: readonly string[];
  readonly strip: StripResource;
}

/** The run a timeline belongs to — the attempts card's header. */
export interface TimelineRunResource {
  readonly id: string;
  readonly issueNumber: number;
  readonly issueTitle: string;
  /** `Loop #1847`. */
  readonly loopSeq: number;
  readonly branch: string | null;
  readonly workflowTag: string;
  readonly workflowVersionPin: number | null;
  readonly startedAt: string;
}

/** The dashed *Next* card — decision T8's projection. */
export interface NextStepResource {
  /** What the loop does when the attempt is green. The one next step today. */
  readonly action: "publish_to_pr";
  /** `PR #514`, or null before the run has opened one. */
  readonly pullRequest: { readonly number: number; readonly url: string } | null;
  /** `gated on 63/63` — every case of the latest attempt; null before any attempt. */
  readonly gatedOn: { readonly passed: number; readonly total: number } | null;
  /** Whether the gate holds, is only an intent, or neither. */
  readonly activation: ActivationState;
  readonly intents: { readonly blockUntilGreen: boolean; readonly autoRerunPhysical: boolean };
  /** The PR's `test_suite` gate definition, when it has one. */
  readonly gate: { readonly required: boolean; readonly source: string } | null;
}

/** `GET /api/v1/runs/{id}/test-runs`. */
export interface TestRunTimelineResource {
  readonly run: TimelineRunResource;
  /** Oldest first. */
  readonly attempts: readonly AttemptResource[];
  /** The page's default attempt — the newest; null before any. */
  readonly latestTestRunId: string | null;
  readonly next: NextStepResource;
}

// --- the page -------------------------------------------------------------------------------

/** A case's current flake score. */
export interface CaseFlakeResource {
  readonly state: FlakeState;
  readonly score: number;
  readonly windowRuns: number;
  readonly formulaVersion: number;
}

/** One case, with its retries. Its failure payload is its own route. */
export interface CaseResource {
  readonly id: string;
  readonly caseKey: string;
  readonly name: string;
  readonly classname: string | null;
  readonly status: TestCaseStatus;
  readonly retries: number;
  readonly retryOutcomes: readonly TestAttemptOutcome[];
  readonly durationMs: number | null;
  /** Whether `…/cases/{caseId}/failure` has something to answer. */
  readonly hasFailure: boolean;
  readonly flake: CaseFlakeResource | null;
}

/** Counts of a suite. */
export interface CountsResource {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly flaky: number;
  readonly skipped: number;
}

/** One suite on one platform — a row of the suites card. */
export interface SuiteResource {
  readonly id: string;
  readonly name: string;
  /** The platform tag — `native_sim`, `qemu_cortex_m3`, `rig:helios-rig-02`. */
  readonly platform: string;
  readonly kind: TestSuiteKind;
  readonly resultsFormat: TestSuiteResultsFormat;
  /** The rig's name for a physical suite. */
  readonly rig: string | null;
  /** The rig's bench — `CAN bus + motor + power-cycler`. */
  readonly bench: string | null;
  readonly counts: CountsResource;
  readonly cases: readonly CaseResource[];
}

/** One HIL measurement: the value, its limit, and how it compares with an earlier build. */
export interface MeasurementResource {
  /** `hil_measurements.id` — what the criteria matrix's evidence picker cites (#366). */
  readonly id: string;
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
  readonly limit: number;
  readonly limitKind: HilLimitKind;
  readonly verdict: HilVerdict;
  /** `was 37 in build 1`, composed by V053's trigger; null when nothing changed. */
  readonly comparative: string | null;
  /** How many trials the value is the worst of. */
  readonly trials: number;
}

/** One physical case — a row of the rig card. */
export interface PhysicalCaseResource {
  readonly caseId: string;
  readonly name: string;
  readonly classname: string | null;
  readonly suiteId: string;
  readonly status: TestCaseStatus;
  /** What the rig did — the same for every measurement of the case. */
  readonly procedure: string;
  readonly measurements: readonly MeasurementResource[];
}

/** An attempt's coverage — `87.4% (+0.6%)`. */
export interface CoverageResource {
  readonly percent: number;
  readonly linesCovered: number;
  readonly linesTotal: number;
  /** Percentage points against the previous attempt with coverage. **Absent** when there is none. */
  readonly delta?: number;
  /** The attempt the delta is measured against. Absent exactly when `delta` is. */
  readonly versusAttemptSeq?: number;
}

/** One artifact — a live file, or a tombstone the sweep left. */
export interface ArtifactResource {
  readonly id: string;
  readonly name: string;
  readonly kind: TestArtifactKind;
  readonly sizeBytes: number;
  readonly checksum: string;
  readonly createdAt: string;
  readonly retainedUntil: string;
  /** `retained 30d`. */
  readonly retentionDays: number;
  /** `expired` once the sweep removed the bytes — the row stays. */
  readonly state: "available" | "expired";
  readonly expiredAt: string | null;
  readonly truncated: boolean;
  readonly truncationNote: string | null;
  /** `inline` — text, opens in the browser; `download` — saved. */
  readonly preview: "inline" | "download";
  /** The download route; null once expired. */
  readonly href: string | null;
  /** The attempt's coverage, on a `coverage` artifact. */
  readonly coverage: CoverageResource | null;
}

/** `GET /api/v1/test-runs/{id}`. */
export interface TestRunPageResource {
  readonly runId: string;
  readonly testRun: AttemptResource;
  /** What the parser could not read — the page's banner. Empty when it read everything. */
  readonly parseWarnings: readonly ParseWarning[];
  readonly suites: readonly SuiteResource[];
  readonly physical: readonly PhysicalCaseResource[];
  /** Each classified case's current decision, with its routing receipt. */
  readonly classifications: readonly ClassificationResource[];
  readonly artifacts: readonly ArtifactResource[];
  readonly coverage: CoverageResource | null;
}

/** `GET /api/v1/test-runs/{id}/cases/{caseId}/failure`. */
export interface CaseFailureResource {
  readonly testRunId: string;
  readonly caseId: string;
  readonly caseKey: string;
  readonly name: string;
  readonly classname: string | null;
  readonly suite: string;
  readonly platform: string;
  readonly status: TestCaseStatus;
  readonly retryOutcomes: readonly TestAttemptOutcome[];
  readonly message: string | null;
  readonly logExcerpt: string | null;
  /** `tests/hil/test_estop_release.py`. */
  readonly path: string | null;
}

// --- mapping --------------------------------------------------------------------------------

/**
 * A `bigint` or `numeric` column as a number, keeping null.
 *
 * @param value - The column.
 * @returns The number, or null.
 */
function numberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * The rig a platform names.
 *
 * @param platform - A suite's platform.
 * @returns `helios-rig-02` for `rig:helios-rig-02`; null for a board or simulator.
 */
export function rigOf(platform: string): string | null {
  return platform.startsWith(RIG_PREFIX) ? platform.slice(RIG_PREFIX.length) : null;
}

/**
 * An attempt's counts as {@link passedDelta} reads them.
 *
 * @param row - The attempt.
 * @returns Its id, ordinal and counts.
 */
export function deltaAttempt(row: AttemptRow): DeltaAttempt {
  return {
    id: row.id,
    attemptSeq: row.attempt_seq,
    counts: {
      total: row.total,
      passed: row.passed,
      failed: row.failed,
      flaky: row.flaky,
      skipped: row.skipped,
    },
  };
}

/**
 * The retry a flaky case passed on.
 *
 * @param outcomes - Its attempts' outcomes in order.
 * @returns The index of the first pass — the retry number, the first run being 0.
 */
export function passedOnRetry(outcomes: readonly TestAttemptOutcome[]): number {
  const index = outcomes.indexOf("passed");
  return index < 0 ? outcomes.length - 1 : index;
}

/** What {@link attemptResource} needs besides the attempt itself. */
export interface AttemptContext {
  /** Every attempt of the run, for the delta. */
  readonly siblings: readonly AttemptRow[];
  /** The attempt's suites. */
  readonly suites: readonly SuiteRow[];
  /** At least the attempt's failed, error and flaky cases. Others are ignored. */
  readonly cases: readonly CaseRow[];
  /** Flake states by case key. */
  readonly flakes: ReadonlyMap<string, FlakeRow>;
}

/**
 * An attempt, strip and all.
 *
 * @param row - The attempt.
 * @param context - Its siblings, suites, cases and flake states.
 * @returns The resource.
 */
export function attemptResource(row: AttemptRow, context: AttemptContext): AttemptResource {
  const own = <T extends { test_run_id: string }>(rows: readonly T[]): T[] =>
    rows.filter((each) => each.test_run_id === row.id);
  const suites = own(context.suites);
  const cases = own(context.cases);
  const brief = (each: CaseRow): StripCaseResource => ({
    caseId: each.id,
    name: each.name,
    suite: each.suite,
    physical: each.suite_kind === "physical",
  });

  const wallMs = numberOrNull(row.wall_ms);
  const simMs = numberOrNull(row.sim_ms);
  const physicalMs = numberOrNull(row.physical_ms);

  return {
    id: row.id,
    attemptSeq: row.attempt_seq,
    status: row.status,
    commitSha: row.commit_sha,
    startedAt: row.started_at.toISOString(),
    lastReceivedAt: row.updated_at.toISOString(),
    selection: row.test_selection?.scope ?? null,
    build:
      row.build_job_id === null
        ? null
        : { jobId: row.build_job_id, number: row.job_number, runner: row.runner_name },
    rigs: [...new Set(suites.map((suite) => rigOf(suite.platform)).filter((rig) => rig !== null))],
    strip: {
      total: row.total,
      suiteCount: suites.length,
      passed: row.passed,
      passedDelta: passedDelta(context.siblings.map(deltaAttempt), row.id),
      failed: row.failed,
      failedCases: cases
        .filter((each) => each.status === "failed" || each.status === "error")
        .map(brief),
      flaky: row.flaky,
      flakyCases: cases
        .filter((each) => each.status === "flaky")
        .map((each) => ({
          ...brief(each),
          passedOnRetry: passedOnRetry(each.retry_outcomes),
          attempts: each.retry_outcomes.length,
          flakeState: context.flakes.get(each.case_key)?.state ?? null,
        })),
      skipped: row.skipped,
      wallTime:
        wallMs === null || simMs === null || physicalMs === null
          ? null
          : { wallMs, simMs, physicalMs },
    },
  };
}

/**
 * The run a timeline belongs to.
 *
 * @param row - The run.
 * @returns The resource.
 */
export function timelineRunResource(row: RunRow): TimelineRunResource {
  return {
    id: row.id,
    issueNumber: row.issue_number,
    issueTitle: row.issue_title,
    loopSeq: row.loop_seq,
    branch: row.branch_name,
    workflowTag: row.workflow_tag,
    workflowVersionPin: row.workflow_version_pin,
    startedAt: row.started_at.toISOString(),
  };
}

/**
 * A case, with its flake state.
 *
 * @param row - The case.
 * @param flake - Its score, when it has one.
 * @returns The resource.
 */
export function caseResource(row: CaseRow, flake: FlakeRow | undefined): CaseResource {
  const failure = row.failure;

  return {
    id: row.id,
    caseKey: row.case_key,
    name: row.name,
    classname: row.classname,
    status: row.status,
    retries: row.retries,
    retryOutcomes: row.retry_outcomes,
    durationMs: numberOrNull(row.duration_ms),
    hasFailure: failure !== null && Object.keys(failure).length > 0,
    flake:
      flake === undefined
        ? null
        : {
            state: flake.state,
            score: Number(flake.score),
            windowRuns: flake.window_runs,
            formulaVersion: flake.formula_version,
          },
  };
}

/**
 * A suite with its cases.
 *
 * @param row - The suite.
 * @param cases - Its cases, already mapped.
 * @returns The resource.
 */
export function suiteResource(row: SuiteRow, cases: readonly CaseResource[]): SuiteResource {
  const bench = row.meta.bench;

  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    kind: row.kind,
    resultsFormat: row.results_format,
    rig: rigOf(row.platform),
    bench: typeof bench === "string" ? bench : null,
    counts: {
      total: row.total,
      passed: row.passed,
      failed: row.failed,
      flaky: row.flaky,
      skipped: row.skipped,
    },
    cases,
  };
}

/**
 * The rig card: every case with measurements, its measurements grouped under it.
 *
 * @param cases - The attempt's cases.
 * @param measurements - The attempt's measurements.
 * @returns One row per measured case, in the cases' order.
 */
export function physicalResources(
  cases: readonly CaseRow[],
  measurements: readonly MeasurementRow[],
): PhysicalCaseResource[] {
  return cases.flatMap((row) => {
    const own = measurements.filter((each) => each.test_case_id === row.id);
    if (own.length === 0) return [];

    return [
      {
        caseId: row.id,
        name: row.name,
        classname: row.classname,
        suiteId: row.test_suite_id,
        status: row.status,
        procedure: own[0].procedure,
        measurements: own.map((each) => ({
          id: each.id,
          metric: each.metric,
          value: Number(each.value),
          unit: each.unit,
          limit: Number(each.limit_value),
          limitKind: each.limit_kind,
          verdict: each.verdict,
          comparative: each.context,
          trials: each.trials.length,
        })),
      },
    ];
  });
}

/**
 * An attempt's coverage — the delta left out, not zeroed, when there is nothing to compare with.
 *
 * @param row - V059's summary.
 * @returns The resource.
 */
export function coverageResource(row: CoverageRow): CoverageResource {
  return {
    percent: Number(row.percent),
    linesCovered: Number(row.lines_covered),
    linesTotal: Number(row.lines_total),
    ...(row.delta === null || row.previous_attempt_seq === null
      ? {}
      : { delta: Number(row.delta), versusAttemptSeq: row.previous_attempt_seq }),
  };
}

/**
 * An artifact, live or a tombstone. Its storage reference is read by nobody here.
 *
 * @param row - The artifact.
 * @param coverage - The attempt's coverage, attached to a `coverage` artifact.
 * @returns The resource.
 */
export function artifactResource(
  row: ArtifactRow,
  coverage: CoverageResource | null,
): ArtifactResource {
  const expired = row.expired_at !== null;

  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    sizeBytes: Number(row.size_bytes),
    checksum: row.checksum,
    createdAt: row.created_at.toISOString(),
    retainedUntil: row.retained_until.toISOString(),
    retentionDays: retentionDays(row.created_at, row.retained_until),
    state: expired ? "expired" : "available",
    expiredAt: row.expired_at?.toISOString() ?? null,
    truncated: row.truncated,
    truncationNote: row.truncation_note,
    preview: isPreviewable(row.kind, row.name) ? "inline" : "download",
    href: expired ? null : `${ARTIFACT_PATH}/${row.id}`,
    coverage: row.kind === "coverage" ? coverage : null,
  };
}

/**
 * `test_runs.parse_warnings`, as the banner reads it: each warning's four documented fields and
 * nothing else. Anything that is not a warning object — which the parser never writes — is
 * dropped rather than passed through.
 *
 * @param warnings - The column.
 * @returns The warnings.
 */
export function parseWarnings(warnings: readonly unknown[]): ParseWarning[] {
  return warnings.flatMap((each): ParseWarning[] => {
    if (typeof each !== "object" || each === null) return [];

    const { code, file, message, at } = each as Record<string, unknown>;
    if (typeof code !== "string" || typeof file !== "string" || typeof message !== "string") {
      return [];
    }

    return [
      {
        code: code as ParseWarning["code"],
        file,
        message,
        ...(typeof at === "string" ? { at } : {}),
      },
    ];
  });
}

/**
 * A case's failure payload.
 *
 * @param row - The case, known to have a failure.
 * @returns The resource.
 */
export function caseFailureResource(row: CaseRow): CaseFailureResource {
  return {
    testRunId: row.test_run_id,
    caseId: row.id,
    caseKey: row.case_key,
    name: row.name,
    classname: row.classname,
    suite: row.suite,
    platform: row.platform,
    status: row.status,
    retryOutcomes: row.retry_outcomes,
    message: row.failure?.message ?? null,
    logExcerpt: row.failure?.log_excerpt ?? null,
    path: row.failure?.path ?? null,
  };
}
