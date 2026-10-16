/**
 * The push grant's refusals (DI.2, [#1310](https://github.com/NobuData/ouroboros/issues/1310)).
 *
 * Every one of them is answered **before** the workspace's GitHub credential is opened, and all
 * but the last before any network call: the engine asked to push a run's branch, and the control
 * plane says no in the error envelope, naming the branch and the reason in a sentence the engine
 * ends the stage with.
 *
 * ```
 * code                    status   when
 * force_push_refused      409      the request asked for a force push — never granted
 * branch_mismatch         409      the branch is not the run's own (`runs.branch_name`)
 * not_a_run_branch        409      the run's branch is not under `ouro/run-*`
 * default_branch          409      the branch is the repository's default branch
 * changes_not_evaluated   409      the guardrail service has not judged this change-set
 * guardrail_blocking      409      a check failed in `block` mode
 * github_not_configured   409      the workspace holds no GitHub credential to push with
 * protected_branch        409      GitHub reports the branch as protected
 * branch_check_failed     502      GitHub could not be asked whether it is
 * ```
 */

import { ConflictError, UpstreamError } from "../errors/error.envelope";

/** The codes, as the envelope spells them. */
export const RUN_PUSH_ERRORS = {
  forcePushRefused: "force_push_refused",
  branchMismatch: "branch_mismatch",
  notARunBranch: "not_a_run_branch",
  defaultBranch: "default_branch",
  changesNotEvaluated: "changes_not_evaluated",
  guardrailBlocking: "guardrail_blocking",
  githubNotConfigured: "github_not_configured",
  protectedBranch: "protected_branch",
  branchCheckFailed: "branch_check_failed",
} as const;

/** One of {@link RUN_PUSH_ERRORS}' values. */
export type RunPushErrorCode = (typeof RUN_PUSH_ERRORS)[keyof typeof RUN_PUSH_ERRORS];

/**
 * `409` — the request asked for a force push.
 *
 * @param branch - The branch.
 * @returns The error to throw.
 */
export function forcePushRefused(branch: string): ConflictError {
  return new ConflictError(
    RUN_PUSH_ERRORS.forcePushRefused,
    `A force push of ${branch} was refused: a run's branch only ever moves forward.`,
    { branch },
  );
}

/**
 * `409` — the branch is not the run's own.
 *
 * @param branch - The branch asked for.
 * @param runBranch - The run's branch, or null when it has none.
 * @returns The error to throw.
 */
export function branchMismatch(branch: string, runBranch: string | null): ConflictError {
  return new ConflictError(
    RUN_PUSH_ERRORS.branchMismatch,
    `A push of ${branch} was refused: this run's branch is ${runBranch ?? "not set"}.`,
    { branch, run_branch: runBranch ?? "" },
  );
}

/**
 * `409` — the run's branch is outside `ouro/run-*`.
 *
 * @param branch - The branch.
 * @returns The error to throw.
 */
export function notARunBranch(branch: string): ConflictError {
  return new ConflictError(
    RUN_PUSH_ERRORS.notARunBranch,
    `A push of ${branch} was refused: Ouroboros pushes only branches named ouro/run-*.`,
    { branch },
  );
}

/**
 * `409` — the branch is the repository's default branch.
 *
 * @param branch - The branch.
 * @returns The error to throw.
 */
export function defaultBranch(branch: string): ConflictError {
  return new ConflictError(
    RUN_PUSH_ERRORS.defaultBranch,
    `A push of ${branch} was refused: it is the repository's default branch.`,
    { branch },
  );
}

/**
 * `409` — the guardrail service has not judged the change-set the push would publish.
 *
 * @param branch - The branch.
 * @param asked - The change-set the engine said it is pushing.
 * @param current - The run's latest change-set.
 * @returns The error to throw.
 */
export function changesNotEvaluated(branch: string, asked: number, current: number): ConflictError {
  return new ConflictError(
    RUN_PUSH_ERRORS.changesNotEvaluated,
    `A push of ${branch} was refused: its changes have not been evaluated by every guardrail check.`,
    { branch, change_set_seq: asked, current_change_set_seq: current },
  );
}

/**
 * `409` — a guardrail check failed in `block` mode.
 *
 * @param branch - The branch.
 * @param checks - The blocking checks, in the card's order.
 * @returns The error to throw.
 */
export function guardrailBlocking(branch: string, checks: readonly string[]): ConflictError {
  return new ConflictError(
    RUN_PUSH_ERRORS.guardrailBlocking,
    `A push of ${branch} was refused: the ${checks.join(", ")} guardrail ${checks.length === 1 ? "check blocks" : "checks block"} it.`,
    { branch, checks: checks.join(",") },
  );
}

/**
 * `409` — the workspace holds no GitHub credential to push with.
 *
 * @param branch - The branch.
 * @returns The error to throw.
 */
export function githubNotConfigured(branch: string): ConflictError {
  return new ConflictError(
    RUN_PUSH_ERRORS.githubNotConfigured,
    `A push of ${branch} was refused: this workspace has no GitHub token to push with.`,
    { branch },
  );
}

/**
 * `409` — GitHub reports the branch as protected.
 *
 * @param branch - The branch.
 * @returns The error to throw.
 */
export function protectedBranch(branch: string): ConflictError {
  return new ConflictError(
    RUN_PUSH_ERRORS.protectedBranch,
    `A push of ${branch} was refused: GitHub reports the branch as protected.`,
    { branch },
  );
}

/**
 * `502` — GitHub could not be asked whether the branch is protected, so nothing was granted.
 *
 * @param branch - The branch.
 * @param failure - The GitHub client's classified reason.
 * @returns The error to throw.
 */
export function branchCheckFailed(branch: string, failure: string): UpstreamError {
  return new UpstreamError(
    RUN_PUSH_ERRORS.branchCheckFailed,
    `A push of ${branch} was refused: GitHub could not be asked whether the branch is protected (${failure}).`,
    { branch, failure },
  );
}
