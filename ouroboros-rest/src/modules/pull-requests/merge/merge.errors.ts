/**
 * The merge executor's refusals, as the error envelope carries them.
 *
 * AX.4 ([#360](https://github.com/NobuData/ouroboros/issues/360)). A PR the workspace does not have
 * is the criteria service's own `404 pull_request_not_found` (AX.3, #359), reused so the PR routes
 * answer one code for one situation.
 */

import { ConflictError, ForbiddenError } from "../../errors/error.envelope";
import type { PullRequestState } from "../../db/schema";
import type { MergeRefusalCode } from "./merge.recheck";

/** The `code` of each refusal. */
export const MERGE_ERRORS = Object.freeze({
  /** The PR is not in a state that can be armed. `409`. */
  notArmable: "merge_plan_not_armable",
  /** The revision the caller looked at is no longer the PR's latest. `409`. */
  staleRevision: "merge_revision_stale",
  /** The plan has merged, and what it did is final. `409`. */
  merged: "merge_plan_merged",
  /** A `member` asked, and the PR's pinned workflow does not auto-merge. `403`. */
  forbidden: "merge_not_policy_eligible",
  /** The re-check refused the merge — `details.reason` says why. `409`. */
  recheckFailed: "merge_recheck_failed",
});

/**
 * @param prId - The PR.
 * @param state - Where it stands.
 * @returns The `409` for a PR that cannot be armed from where it is.
 */
export function mergePlanNotArmable(prId: string, state: PullRequestState): ConflictError {
  return new ConflictError(
    MERGE_ERRORS.notArmable,
    state === "blocked"
      ? "A required gate is red — fix it before arming."
      : state === "open"
        ? "The PR's gates have not been evaluated yet."
        : `A ${state} PR cannot be armed.`,
    { prId, state },
  );
}

/**
 * @param prId - The PR.
 * @param revisionId - The revision the caller named.
 * @param latestId - The PR's latest revision, or null.
 * @returns The `409` for arming against a revision that is not the latest — the person looked at
 *   gates that no longer describe the head.
 */
export function mergeRevisionStale(
  prId: string,
  revisionId: string,
  latestId: string | null,
): ConflictError {
  return new ConflictError(
    MERGE_ERRORS.staleRevision,
    "A newer revision exists — review its gates before arming.",
    { prId, revisionId, latestRevisionId: latestId },
  );
}

/**
 * @param prId - The PR.
 * @returns The `409` for a plan that has already merged.
 */
export function mergePlanMerged(prId: string): ConflictError {
  return new ConflictError(MERGE_ERRORS.merged, "This PR has merged; its plan is final.", { prId });
}

/**
 * @param prId - The PR.
 * @returns The `403` for a member whose PR's policy does not let a member merge.
 */
export function mergeNotPolicyEligible(prId: string): ForbiddenError {
  return new ForbiddenError(
    MERGE_ERRORS.forbidden,
    "Only an owner or admin may merge this PR — its pinned workflow does not auto-merge.",
    { prId },
  );
}

/**
 * @param prId - The PR.
 * @param refused - The re-check's code and sentence, and whether it disarmed an armed plan.
 * @returns The `409` a direct merge answers when the re-check refused it.
 */
export function mergeRecheckFailed(
  prId: string,
  refused: {
    readonly code: MergeRefusalCode;
    readonly message: string;
    readonly disarmed: boolean;
  },
): ConflictError {
  return new ConflictError(MERGE_ERRORS.recheckFailed, refused.message, {
    prId,
    reason: refused.code,
    disarmed: refused.disarmed,
  });
}
