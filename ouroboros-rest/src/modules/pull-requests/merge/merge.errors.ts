/**
 * The merge executor's refusals, as the error envelope carries them.
 *
 * AX.4 ([#360](https://github.com/NobuData/ouroboros/issues/360)). A PR the workspace does not have
 * is the criteria service's own `404 pull_request_not_found` (AX.3, #359), reused so the PR routes
 * answer one code for one situation.
 */

import { ConflictError, ForbiddenError, InvalidRequestError } from "../../errors/error.envelope";
import type { PullRequestState } from "../../db/schema";
import { DRY_RUN_CODE, DRY_RUN_REASON } from "../../policies/org-policy.rules";
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
  /** An edit of an armed plan — its terms were confirmed, so it is disarmed first. `409`. */
  armed: "merge_plan_armed",
  /**
   * An edit of a merged or closed PR's plan. `409`. The page plane's own code (`page.errors.ts`),
   * so a client branches on one code for a PR the host owns; restated rather than imported, since
   * the page plane already imports this one.
   */
  pullRequestNotOpen: "pull_request_not_open",
  /**
   * The workspace's dry-run policy is active (BA.3, #382) — nothing is armed or merged until an
   * owner or admin turns it off. `409`, never a generic `403`: the cause is a policy, stated.
   */
  dryRun: DRY_RUN_CODE,
  /** Back-annotate would be on with no epic to annotate. `422`. */
  epicRequired: "merge_plan_epic_required",
  /** The epic is not one of this workspace's. `422`. */
  epicNotFound: "merge_plan_epic_not_found",
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
export function mergeNotPolicyEligible(prId: string, policy?: AutoMergeStanding): ForbiddenError {
  return new ForbiddenError(
    MERGE_ERRORS.forbidden,
    policy === undefined
      ? "Only an owner or admin may merge this PR — its pinned workflow does not auto-merge."
      : autoMergeIneligibleMessage(policy.reason),
    policy === undefined ? { prId } : { prId, ruleId: "auto_merge", policyVersion: policy.version },
  );
}

/** What the org policy's `auto_merge` rule said about a PR it refused (#481). */
export interface AutoMergeStanding {
  /** The rule's sentence. */
  readonly reason: string;
  /** The policy version it was read from. */
  readonly version: number | null;
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

/**
 * @param prId - The PR.
 * @returns The `409` for editing an armed plan — arming confirmed its terms, and a promise is not
 *   reworded after it was made.
 */
export function mergePlanArmed(prId: string): ConflictError {
  return new ConflictError(
    MERGE_ERRORS.armed,
    "This plan is armed — disarm it before changing what it will do.",
    { prId },
  );
}

/**
 * @param prId - The PR.
 * @param state - Where it stands — `merged` or `closed`.
 * @returns The `409` for editing the plan of a PR the host owns.
 */
export function mergePlanPullRequestNotOpen(prId: string, state: PullRequestState): ConflictError {
  return new ConflictError(
    MERGE_ERRORS.pullRequestNotOpen,
    `The pull request is ${state}; its merge plan can no longer be changed.`,
    { prId, state },
  );
}

/**
 * @param prId - The PR.
 * @returns The `422` for switching back-annotate on while the plan names no epic.
 */
export function mergePlanEpicRequired(prId: string): InvalidRequestError {
  return new InvalidRequestError(
    MERGE_ERRORS.epicRequired,
    "Choose the roadmap epic to back-annotate before switching it on.",
    { prId },
  );
}

/**
 * @param prId - The PR.
 * @param epicId - The epic named.
 * @returns The `422` for an epic that is not this workspace's — another workspace's reads the
 *   same as one that does not exist.
 */
export function mergePlanEpicNotFound(prId: string, epicId: string | null): InvalidRequestError {
  return new InvalidRequestError(
    MERGE_ERRORS.epicNotFound,
    "No such roadmap epic in this workspace.",
    { prId, epicId },
  );
}

/** The dry-run refusal's sentence — the designed reason, and the path to the flip. */
export const DRY_RUN_REFUSAL_MESSAGE =
  `${DRY_RUN_REASON} — the PR stays a draft and nothing merges until an owner or admin turns ` +
  "dry-run off in Settings → Policies.";

/**
 * @param prId - The PR.
 * @returns The `409` for arming or merging while the dry-run policy is active — machine-readable
 *   (`details.reason`, `details.policy`) so every surface renders the cause and the flip.
 */
export function mergeDryRunActive(prId: string, standing?: DryRunStanding): ConflictError {
  return new ConflictError(MERGE_ERRORS.dryRun, dryRunRefusalMessage(standing), {
    prId,
    reason: DRY_RUN_CODE,
    policy: "dry_run",
    source: standing?.source ?? "org_override",
    policyVersion: standing?.version ?? null,
  });
}

/** Why one PR is in dry-run (#481) — the org-wide switch, or the policy document's rule. */
export interface DryRunStanding {
  readonly source: "org_override" | "dry_run_new_repos";
  /** The policy version, when the document's rule is the source. */
  readonly version: number | null;
  /** The rule's sentence, when it is the source — *"Loop 3 of this repository is inside …"*. */
  readonly reason?: string;
}

/**
 * The sentence a dry-run refusal carries — naming the per-repository rule when that is the cause,
 * since turning the org-wide switch off would not lift it.
 *
 * @param standing - Why the PR is in dry-run, or undefined for the org-wide switch.
 * @returns The sentence.
 */
export function dryRunRefusalMessage(standing?: DryRunStanding): string {
  if (standing?.source !== "dry_run_new_repos") {
    return DRY_RUN_REFUSAL_MESSAGE;
  }

  return `${DRY_RUN_REASON} — ${standing.reason ?? "this repository is inside its first dry-run loops."} The PR stays a draft and is never merged by Ouroboros.`;
}

/** What an unattended merge the org policy's `auto_merge` rule refused says (#481). */
export function autoMergeIneligibleMessage(reason: string): string {
  return `${reason} Only an owner or admin may merge it, and nothing merges it unattended.`;
}
