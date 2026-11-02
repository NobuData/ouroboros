/**
 * The refusals of a run's build routes (AJ.3, [#265](https://github.com/NobuData/ouroboros/issues/265)).
 *
 * Each is answered in the error envelope with a sentence the engine ends the build stage with —
 * a designed, explained stage failure rather than a stall. The farm's own refusals
 * (`farm_pool_not_found`, `farm_pool_disabled`, `farm_command_required`) pass through unchanged:
 * the submission goes through the farm's one dispatch path and is refused by its rules.
 *
 * ```
 * code                        status   when
 * build_no_eligible_runner    409      no runner of the pool can take the build now — the job
 *                                      was cancelled rather than left waiting
 * run_branch_missing          409      the run has no branch for a runner to check out
 * run_build_not_found         404      no such build of this run
 * ```
 */

import { ConflictError, NotFoundError } from "../errors/error.envelope";

/** The codes, as the envelope spells them. */
export const RUN_BUILD_ERRORS = {
  noEligibleRunner: "build_no_eligible_runner",
  runBranchMissing: "run_branch_missing",
  buildNotFound: "run_build_not_found",
} as const;

/** One of {@link RUN_BUILD_ERRORS}' values. */
export type RunBuildErrorCode = (typeof RUN_BUILD_ERRORS)[keyof typeof RUN_BUILD_ERRORS];

/**
 * `409` — no runner of the pool can take the build: every one is offline, drained, full, or
 * without the pool's executor. The job was submitted, found unplaceable and cancelled, so nothing
 * waits in the pool's queue for a run that has moved on.
 *
 * @param pool - The pool, by name.
 * @param jobNumber - The cancelled job's number, so the farm page's row can be found.
 * @returns The error to throw.
 */
export function noEligibleRunner(pool: string, jobNumber: number): ConflictError {
  return new ConflictError(
    RUN_BUILD_ERRORS.noEligibleRunner,
    `No runner in pool \`${pool}\` can take this build: every runner is offline, drained, ` +
      `full, or lacks the pool's executor. Build #${jobNumber} was cancelled.`,
    { pool, job_number: jobNumber },
  );
}

/**
 * `409` — the run has no branch: a runner checks out the run's branch at the pushed commit, and
 * this run never had one written.
 *
 * @param run - The run.
 * @returns The error to throw.
 */
export function runBranchMissing(run: string): ConflictError {
  return new ConflictError(
    RUN_BUILD_ERRORS.runBranchMissing,
    "This run has no branch, so a runner has nothing to check out. A build stage builds the " +
      "run's pushed branch.",
    { run },
  );
}

/**
 * `404` — no such build of this run: another run's job, another workspace's, a job no run
 * submitted, or none at all — one answer for all of them.
 *
 * @param run - The run.
 * @param job - The job asked for.
 * @returns The error to throw.
 */
export function runBuildNotFound(run: string, job: string): NotFoundError {
  return new NotFoundError(
    RUN_BUILD_ERRORS.buildNotFound,
    "No such build of this run. A run reads only the builds its own stages submitted.",
    { run, job },
  );
}
