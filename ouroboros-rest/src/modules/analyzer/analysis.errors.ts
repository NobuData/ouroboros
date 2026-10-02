/**
 * What the Build Analyzer's routes refuse, and with which code (BV.1,
 * [#510](https://github.com/NobuData/ouroboros/issues/510)).
 */

import { ConflictError, NotFoundError } from "../errors/error.envelope";
import type { AnalysisRunRow } from "./analysis.repository";

/** The codes the analyzer routes answer with. */
export const ANALYSIS_ERRORS = {
  /** The repository already has a running analysis. */
  alreadyRunning: "analysis_already_running",
  /** No such repository in this workspace. */
  repositoryNotFound: "analysis_repository_not_found",
  /** No such run in this workspace. */
  runNotFound: "analysis_run_not_found",
} as const;

/**
 * The concurrent-run guard's answer — actionable: it names the run that is going, so the UI says
 * *"an analysis is already running — started 4 min ago, analyzing"* and links to it rather than
 * silently queuing a second one.
 *
 * @param repoRef - The repository.
 * @param running - The run already going, when it could be read.
 * @returns The `409`.
 */
export function analysisAlreadyRunning(
  repoRef: string,
  running: AnalysisRunRow | undefined,
): ConflictError {
  return new ConflictError(
    ANALYSIS_ERRORS.alreadyRunning,
    `An analysis of ${repoRef} is already running. Wait for it to finish, or follow its progress.`,
    running === undefined
      ? { repo: repoRef }
      : {
          repo: repoRef,
          runId: running.id,
          trigger: running.trigger,
          phase: running.phase,
          startedAt: running.started_at.toISOString(),
        },
  );
}

/**
 * @param repoRef - The repository asked for.
 * @returns The `404` for a repository this workspace does not have.
 */
export function analysisRepositoryNotFound(repoRef: string): NotFoundError {
  return new NotFoundError(
    ANALYSIS_ERRORS.repositoryNotFound,
    `This workspace has no repository ${repoRef}.`,
  );
}

/**
 * @returns The `404` for a run this workspace does not have.
 */
export function analysisRunNotFound(): NotFoundError {
  return new NotFoundError(ANALYSIS_ERRORS.runNotFound, "No such analysis run in this workspace.");
}
