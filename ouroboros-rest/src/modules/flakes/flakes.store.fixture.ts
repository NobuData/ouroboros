/**
 * A scripted {@link FlakesStore} — what the flake scorer's and the state API's unit suites run on
 * (AT.3, #331). It records every call and answers what a test set; `flakes.integration-spec.ts`
 * checks the real statements and V054's formula.
 */

import type {
  CaseFlakeRow,
  FlakeCandidateRow,
  FlakeCardRow,
  FlakeCardSpan,
  FlakesStore,
  ScorerRunRow,
  ScoringTotals,
  StateCounts,
} from "./flakes.repository";

/** See this file's header. */
export class ScriptedFlakesStore implements FlakesStore {
  /** The formula {@link currentFormula} answers. */
  formula = 1;
  /** The workspaces {@link workspacesToRescore} answers. */
  workspaces: string[] = [];
  /** What each scoring call answers, or throws, by workspace; absent is zero. */
  totals: Record<string, ScoringTotals | Error> = {};
  /** The candidates, by workspace. */
  candidateRows: Record<string, FlakeCandidateRow[]> = {};
  /** The card rows {@link card} answers, by workspace. */
  cardRows: Record<string, FlakeCardRow[]> = {};
  /** The counts {@link stateCounts} answers. */
  counts: StateCounts = { watching: 0, quarantined: 0 };
  /** The run {@link lastRun} answers. */
  latestRun?: ScorerRunRow;
  /** The rows {@link caseState} answers, by case key. */
  cases: Record<string, CaseFlakeRow> = {};

  /** Every call, in order, as `[method, ...arguments]`. */
  readonly calls: unknown[][] = [];

  /** @inheritdoc */
  currentFormula(): Promise<number> {
    return Promise.resolve(this.formula);
  }

  /** @inheritdoc */
  scoreAttempt(
    organizationId: string,
    testRunId: string,
    formulaVersion: number,
  ): Promise<ScoringTotals> {
    this.calls.push(["scoreAttempt", organizationId, testRunId, formulaVersion]);
    return this.answer(organizationId);
  }

  /** @inheritdoc */
  rescoreActive(
    organizationId: string,
    formulaVersion: number,
    cap: number,
  ): Promise<ScoringTotals> {
    this.calls.push(["rescoreActive", organizationId, formulaVersion, cap]);
    return this.answer(organizationId);
  }

  /** @inheritdoc */
  workspacesToRescore(formulaVersion: number): Promise<string[]> {
    this.calls.push(["workspacesToRescore", formulaVersion]);
    return Promise.resolve([...this.workspaces]);
  }

  /** @inheritdoc */
  startRun(organizationId: string, formulaVersion: number): Promise<string> {
    this.calls.push(["startRun", organizationId, formulaVersion]);
    return Promise.resolve(`run-${organizationId}`);
  }

  /** @inheritdoc */
  finishRun(runId: string, totals: ScoringTotals): Promise<void> {
    this.calls.push(["finishRun", runId, totals]);
    return Promise.resolve();
  }

  /** @inheritdoc */
  failRun(runId: string, error: string): Promise<void> {
    this.calls.push(["failRun", runId, error]);
    return Promise.resolve();
  }

  /** @inheritdoc */
  candidates(organizationId: string, limit: number): Promise<FlakeCandidateRow[]> {
    this.calls.push(["candidates", organizationId, limit]);
    return Promise.resolve(this.candidateRows[organizationId] ?? []);
  }

  /** @inheritdoc */
  card(organizationId: string, span: FlakeCardSpan, repo?: string): Promise<FlakeCardRow[]> {
    this.calls.push(["card", organizationId, span, repo]);
    return Promise.resolve(this.cardRows[organizationId] ?? []);
  }

  /** @inheritdoc */
  stateCounts(organizationId: string): Promise<StateCounts> {
    this.calls.push(["stateCounts", organizationId]);
    return Promise.resolve(this.counts);
  }

  /** @inheritdoc */
  lastRun(organizationId: string): Promise<ScorerRunRow | undefined> {
    this.calls.push(["lastRun", organizationId]);
    return Promise.resolve(this.latestRun);
  }

  /** @inheritdoc */
  caseState(organizationId: string, caseKey: string): Promise<CaseFlakeRow | undefined> {
    this.calls.push(["caseState", organizationId, caseKey]);
    return Promise.resolve(this.cases[caseKey]);
  }

  /**
   * The scripted totals for a workspace.
   *
   * @param organizationId - The workspace.
   * @returns Them, zero when unscripted; rejects with a scripted error.
   */
  private answer(organizationId: string): Promise<ScoringTotals> {
    const scripted = this.totals[organizationId] ?? { scored: 0, stateChanges: 0 };

    return scripted instanceof Error ? Promise.reject(scripted) : Promise.resolve(scripted);
  }
}

/**
 * A candidate row with defaults.
 *
 * @param caseKey - Its key.
 * @param score - Its score.
 * @returns The row.
 */
export function candidateRow(caseKey: string, score: number): FlakeCandidateRow {
  return {
    caseKey,
    githubRepoId: "repo",
    repository: "helios-firmware",
    name: "ring buffer drains under burst",
    classname: "telemetry",
    suite: "telemetry integration",
    score,
    windowRuns: 4,
    state: "watching",
    formulaVersion: 1,
    lastScoredAt: new Date("2026-09-27T03:10:00.000Z"),
    stateChangedAt: new Date("2026-09-26T12:00:00.000Z"),
  };
}
