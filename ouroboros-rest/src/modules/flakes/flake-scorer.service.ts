/**
 * The flake scorer (AT.3, [#331](https://github.com/NobuData/ouroboros/issues/331), option **4-A**,
 * decision **T5**) — retry truth plus history.
 *
 * ```
 * parse (#329) ─▶ occurrence per case (test-results.repository.ts) ─▶ scoreAttempt ─▶ healthy ⇄ watching
 * nightly      ─▶ rescoreAll: per workspace, bounded ─▶ bookkeeping row ─▶ candidates[]
 * ```
 *
 * **Two callers, one formula.** The parse path scores the cases an attempt touched as soon as their
 * occurrences are written, so the strip's `watching` is current the moment a build is parsed. The
 * nightly pass re-scores what parsing never revisits: a case scored under an older formula, and any
 * active case whose score a newer occurrence has not yet moved. Both go through the same statement
 * (`flakes.repository.ts`), which calls V054's `flake_score()` and `flake_state_next()`.
 *
 * **The nightly pass is bounded and observable.** Each workspace gets a `flake_scorer_runs` row
 * opened before the work and closed with the cases scored and the state changes — or with the
 * error — and at most `OURO_FLAKE_RESCORE_CAP` cases are re-scored per workspace per night, least
 * recently scored first, so what a night leaves is first in line the next. A workspace that fails
 * is recorded as failed and the pass moves on to the next. The pass is idempotent — the same
 * occurrences score the same — so two replicas that both run a night cost a duplicate bookkeeping
 * row, never a wrong score.
 */

import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import {
  FlakesRepository,
  type FlakeCandidateRow,
  type FlakesStore,
  type ScoringTotals,
} from "./flakes.repository";

/** How many candidates the nightly pass emits and the summary lists, per workspace. */
export const CANDIDATE_LIMIT = 50;

/** What scoring an attempt did — what the parse report carries. */
export interface AttemptScoring extends ScoringTotals {
  /** The formula every score was stamped with. */
  readonly formulaVersion: number;
}

/** One workspace's nightly pass. */
export interface WorkspaceRescore {
  readonly organizationId: string;
  /** The `flake_scorer_runs` row. */
  readonly runId: string;
  readonly status: "complete" | "error";
  readonly casesScored: number;
  readonly stateChanges: number;
  /** The workspace's cases worth distrusting after the pass — empty when it failed. */
  readonly candidates: readonly FlakeCandidateRow[];
  /** Why the pass failed; absent when it did not. */
  readonly error?: string;
}

/** One night's passes. */
export interface RescoreReport {
  readonly formulaVersion: number;
  /** The per-workspace cap applied. */
  readonly cap: number;
  readonly workspaces: readonly WorkspaceRescore[];
}

/** See this file's header. */
@Injectable()
export class FlakeScorerService {
  /**
   * @param store - The statements.
   * @param config - The nightly cap.
   */
  constructor(
    @Inject(FlakesRepository) private readonly store: FlakesStore,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Score the cases a freshly parsed attempt touched — the parse-time half of the scorer.
   *
   * Called after the attempt's occurrences are written. A case that passed on a sanctioned retry
   * gets (or updates) its score; a case already scored is re-scored with the new occurrence, which
   * is how a clean build walks a watched case back towards `healthy`.
   *
   * @param organizationId - The workspace.
   * @param testRunId - The attempt.
   * @returns What was scored, under which formula.
   */
  async scoreAttempt(organizationId: string, testRunId: string): Promise<AttemptScoring> {
    const formulaVersion = await this.store.currentFormula();
    const totals = await this.store.scoreAttempt(organizationId, testRunId, formulaVersion);

    return { ...totals, formulaVersion };
  }

  /**
   * One nightly pass over every workspace with an active case.
   *
   * @returns What each workspace's pass did. Never rejects for one workspace's failure — that is
   *   recorded on its row and in the report — but does reject when the workspaces cannot even be
   *   listed, which the scheduler logs.
   */
  async rescoreAll(): Promise<RescoreReport> {
    const formulaVersion = await this.store.currentFormula();
    const cap = this.config.flakeRescoreCap;
    const workspaces: WorkspaceRescore[] = [];

    for (const organizationId of await this.store.workspacesToRescore(formulaVersion)) {
      workspaces.push(await this.rescoreWorkspace(organizationId, formulaVersion, cap));
    }

    return { formulaVersion, cap, workspaces };
  }

  /**
   * One workspace's bounded pass, with its bookkeeping row.
   *
   * @param organizationId - The workspace.
   * @param formulaVersion - The formula to apply.
   * @param cap - The most cases to re-score.
   * @returns What the pass did.
   */
  async rescoreWorkspace(
    organizationId: string,
    formulaVersion: number,
    cap: number,
  ): Promise<WorkspaceRescore> {
    const runId = await this.store.startRun(organizationId, formulaVersion);

    try {
      const totals = await this.store.rescoreActive(organizationId, formulaVersion, cap);
      const candidates = await this.store.candidates(organizationId, CANDIDATE_LIMIT);

      await this.store.finishRun(runId, totals);

      return {
        organizationId,
        runId,
        status: "complete",
        casesScored: totals.scored,
        stateChanges: totals.stateChanges,
        candidates,
      };
    } catch (error) {
      const message = failureMessage(error);

      await this.store.failRun(runId, message);

      return {
        organizationId,
        runId,
        status: "error",
        casesScored: 0,
        stateChanges: 0,
        candidates: [],
        error: message,
      };
    }
  }
}

/**
 * A failure as the bookkeeping row's `error` — one line, never blank (V054 refuses a blank one).
 *
 * The message, not the stack: the row is read by an operator asking *why did last night fail*,
 * and the stack is the log's.
 *
 * @param error - What was thrown.
 * @returns A one-line reason.
 */
export function failureMessage(error: unknown): string {
  const text = (error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    .replace(/\s+/g, " ")
    .trim();

  return text.length > 0 ? text : "the re-score failed without a message";
}
