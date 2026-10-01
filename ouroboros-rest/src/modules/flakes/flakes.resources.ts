/**
 * What the flake state routes answer with — AT.3 ([#331](https://github.com/NobuData/ouroboros/issues/331)).
 *
 * Two reads: one case's flake and quarantine state ({@link CaseFlakeResource}), which the strip's
 * *"quarantine watching"* reads for a flaky case, and the workspace summary
 * ({@link FlakeSummaryResource}) — the `watching` count, the candidates list the future insights
 * page consumes, and the nightly job's last run, so the job is observable from the API too.
 */

import type { FlakeScorerRunStatus, FlakeState } from "../db/schema";
import type {
  CaseFlakeRow,
  FlakeCandidateRow,
  FlakeCardDay,
  FlakeCardRow,
  FlakeResolution,
  ScorerRunRow,
  StateCounts,
} from "./flakes.repository";

/** A case's score, as the state API reads it. */
export interface FlakeScoreResource {
  /** In [0, 1], four decimals — V054's `flake_score()`. */
  readonly score: number;
  /** How many occurrences the score covers. */
  readonly windowRuns: number;
  readonly state: FlakeState;
  /** The formula that produced the score. */
  readonly formulaVersion: number;
  readonly lastScoredAt: string;
  /** When the case entered its current state. */
  readonly stateChangedAt: string;
}

/** `GET /api/v1/flakes/cases/{caseKey}`. */
export interface CaseFlakeResource {
  readonly caseKey: string;
  readonly githubRepoId: string;
  /** `healthy` for an observed case never scored — V054's *"a new case: healthy"*. */
  readonly state: FlakeState;
  /** True exactly when `state` is `quarantined` — a soft signal, never written in the MVP. */
  readonly quarantined: boolean;
  /** Every non-skipped occurrence of the case in the workspace. */
  readonly observed: number;
  /** How many of them were sanctioned passes on retry. */
  readonly passOnRetry: number;
  /** Null when the case has never been scored. */
  readonly score: FlakeScoreResource | null;
}

/** One entry of the candidates list. */
export interface FlakeCandidateResource extends FlakeScoreResource {
  readonly caseKey: string;
  readonly githubRepoId: string;
  readonly repository: string;
  readonly name: string | null;
  readonly classname: string | null;
  readonly suite: string | null;
}

/** A nightly pass, as its bookkeeping row holds it. */
export interface FlakeScorerRunResource {
  readonly id: string;
  readonly formulaVersion: number;
  readonly status: FlakeScorerRunStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly durationMs: number | null;
  readonly casesScored: number;
  readonly stateChanges: number;
  readonly error: string | null;
}

/** `GET /api/v1/flakes/summary`. */
export interface FlakeSummaryResource {
  /** The formula the scorer applies now. */
  readonly formulaVersion: number;
  /** The strip's count. */
  readonly watching: number;
  readonly quarantined: number;
  /** Every non-healthy case, highest score first, at most fifty. */
  readonly candidates: readonly FlakeCandidateResource[];
  /** The latest nightly pass, or null before the first. */
  readonly lastRun: FlakeScorerRunResource | null;
}

/**
 * A case row as its resource.
 *
 * @param row - The row.
 * @returns The resource.
 */
export function caseFlakeResource(row: CaseFlakeRow): CaseFlakeResource {
  const state = row.score?.state ?? "healthy";

  return {
    caseKey: row.caseKey,
    githubRepoId: row.githubRepoId,
    state,
    quarantined: state === "quarantined",
    observed: row.observed,
    passOnRetry: row.passOnRetry,
    score:
      row.score === undefined
        ? null
        : {
            score: row.score.score,
            windowRuns: row.score.windowRuns,
            state: row.score.state,
            formulaVersion: row.score.formulaVersion,
            lastScoredAt: row.score.lastScoredAt.toISOString(),
            stateChangedAt: row.score.stateChangedAt.toISOString(),
          },
  };
}

/**
 * A candidate row as its resource.
 *
 * @param row - The row.
 * @returns The resource.
 */
export function candidateResource(row: FlakeCandidateRow): FlakeCandidateResource {
  return {
    caseKey: row.caseKey,
    githubRepoId: row.githubRepoId,
    repository: row.repository,
    name: row.name,
    classname: row.classname,
    suite: row.suite,
    score: row.score,
    windowRuns: row.windowRuns,
    state: row.state,
    formulaVersion: row.formulaVersion,
    lastScoredAt: row.lastScoredAt.toISOString(),
    stateChangedAt: row.stateChangedAt.toISOString(),
  };
}

/**
 * A scorer run row as its resource.
 *
 * @param row - The row.
 * @returns The resource.
 */
export function scorerRunResource(row: ScorerRunRow): FlakeScorerRunResource {
  return {
    id: row.id,
    formulaVersion: row.formulaVersion,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt === null ? null : row.finishedAt.toISOString(),
    durationMs: row.durationMs,
    casesScored: row.casesScored,
    stateChanges: row.stateChanges,
    error: row.error,
  };
}

/**
 * The summary's parts as its resource.
 *
 * @param formulaVersion - The current formula.
 * @param counts - The state counts.
 * @param candidates - The candidates.
 * @param lastRun - The latest nightly pass, or undefined.
 * @returns The resource.
 */
export function summaryResource(
  formulaVersion: number,
  counts: StateCounts,
  candidates: readonly FlakeCandidateRow[],
  lastRun: ScorerRunRow | undefined,
): FlakeSummaryResource {
  return {
    formulaVersion,
    watching: counts.watching,
    quarantined: counts.quarantined,
    candidates: candidates.map(candidateResource),
    lastRun: lastRun === undefined ? null : scorerRunResource(lastRun),
  };
}

/**
 * A case's state on the Insights flaky card (BJ.2,
 * [#438](https://github.com/NobuData/ouroboros/issues/438)): the two stored distrust states, and
 * `fixed` — a case that returned to `healthy` inside the window. `fixed` is derived, never
 * stored: V054's vocabulary stays `healthy | watching | quarantined`.
 */
export type FlakeCardState = "fixed" | "watching" | "quarantined";

/** One case of the flaky card, as the facts stand — the page shapes the rate and the trend. */
export interface FlakeCardCase {
  readonly caseKey: string;
  /** The repository's name. */
  readonly repository: string;
  readonly name: string | null;
  readonly classname: string | null;
  readonly suite: string | null;
  readonly state: FlakeCardState;
  /** The stored score, in [0, 1]. */
  readonly score: number;
  readonly stateChangedAt: string;
  /** The window's non-skipped occurrences. */
  readonly observed: number;
  /** How many of them passed only on retry. */
  readonly flaky: number;
  /** Occurrences per UTC day, oldest first; a day the case did not run is absent. */
  readonly history: readonly FlakeCardDay[];
  /**
   * The one platform every flaky occurrence in the window ran on — `rig:hil-rig-02` — or null
   * when there were none or they ran on several. Never guessed.
   */
  readonly platform: string | null;
  /**
   * The loop whose test run first passed cleanly after the case's last flaky occurrence — only
   * on a `fixed` case, and null when no such occurrence names a loop.
   */
  readonly resolvedBy: FlakeResolution | null;
}

/**
 * A card row as the card's case.
 *
 * @param row - The row; a healthy one is a case that came back inside the window.
 * @returns The case.
 */
export function flakeCardCase(row: FlakeCardRow): FlakeCardCase {
  const fixed = row.state === "healthy";

  return {
    caseKey: row.caseKey,
    repository: row.repository,
    name: row.name,
    classname: row.classname,
    suite: row.suite,
    state: fixed ? "fixed" : row.state,
    score: row.score,
    stateChangedAt: row.stateChangedAt.toISOString(),
    observed: row.history.reduce((total, day) => total + day.observed, 0),
    flaky: row.history.reduce((total, day) => total + day.flaky, 0),
    history: row.history,
    platform: row.flakyPlatforms.length === 1 ? row.flakyPlatforms[0] : null,
    resolvedBy: fixed ? row.resolvedBy : null,
  };
}
