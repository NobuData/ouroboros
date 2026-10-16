/**
 * The draft pull-request publisher's refusals (DI.3,
 * [#1311](https://github.com/NobuData/ouroboros/issues/1311)).
 *
 * After the execution contract's own two (`409 fenced`, `409 run_not_executable`), checked in
 * this order — every one before the run is linked to any PR, and the first two before the host
 * is asked anything:
 *
 * ```
 * code                    status   when
 * not_pushed              409      the run's branch has no recorded successful push (DI.2's
 *                                  `run.branch_pushed` with outcome `pushed`)
 * pr_source_unavailable   409      no git-host ticket source mirrors the run's issue, its
 *                                  provider cannot open pull requests (`pr.create` false), or
 *                                  the repository has no default branch to propose into
 * draft_refused           409      the host would not hold the PR as a draft — a validation
 *                                  refusal, or an answer with `draft: false` (an already-open
 *                                  ready PR on the branch among them); nothing is linked
 * pr_create_failed        502      any other refusal from the host, by its class
 * ```
 */

import { ConflictError, UpstreamError } from "../errors/error.envelope";

/** The codes, as the envelope spells them. */
export const RUN_PULL_REQUEST_ERRORS = {
  notPushed: "not_pushed",
  prSourceUnavailable: "pr_source_unavailable",
  draftRefused: "draft_refused",
  prCreateFailed: "pr_create_failed",
} as const;

/** One of {@link RUN_PULL_REQUEST_ERRORS}' values. */
export type RunPullRequestErrorCode =
  (typeof RUN_PULL_REQUEST_ERRORS)[keyof typeof RUN_PULL_REQUEST_ERRORS];

/** Why nothing can open a PR for the run's issue — `details.reason`. */
export type PrSourceUnavailableReason = "no_source" | "no_pull_requests" | "no_base_branch";

/** Each {@link PrSourceUnavailableReason}, as the sentence says it. */
const PR_SOURCE_UNAVAILABLE_REASONS: Readonly<Record<PrSourceUnavailableReason, string>> = {
  no_source: "no GitHub ticket source mirrors this run's issue",
  no_pull_requests: "the issue's ticket source cannot open pull requests",
  no_base_branch: "the repository has no known default branch to propose the run's branch into",
};

/**
 * `409` — the run's branch was never pushed, so the host has nothing to open a PR from.
 *
 * @param branch - The run's branch, or null when it has none.
 * @returns The error to throw.
 */
export function notPushed(branch: string | null): ConflictError {
  return new ConflictError(
    RUN_PULL_REQUEST_ERRORS.notPushed,
    `No pull request was opened: ${branch ?? "this run's branch"} has no recorded successful push.`,
    { branch: branch ?? "" },
  );
}

/**
 * `409` — nothing can open a PR for the run's issue.
 *
 * @param reason - Why: no source mirrors the issue, the source's provider opens no PRs, or the
 *   repository has no known default branch to propose the run's branch into.
 * @param sourceId - The source, when one was found.
 * @returns The error to throw.
 */
export function prSourceUnavailable(
  reason: PrSourceUnavailableReason,
  sourceId: string | null,
): ConflictError {
  const why = PR_SOURCE_UNAVAILABLE_REASONS[reason];

  return new ConflictError(
    RUN_PULL_REQUEST_ERRORS.prSourceUnavailable,
    `No pull request was opened: ${why}.`,
    { reason, source_id: sourceId ?? "" },
  );
}

/**
 * `409` — the host would not hold the PR as a draft. Nothing is linked to the run.
 *
 * @param details - The host's own message, or the url of the PR it answered as ready.
 * @returns The error to throw.
 */
export function draftRefused(
  details: { readonly message: string } | { readonly url: string; readonly number: number },
): ConflictError {
  const message =
    "message" in details
      ? `No pull request was opened: the host refused to open it as a draft (${details.message}).`
      : `No pull request was linked: the host answered #${String(details.number)} (${details.url}), which is not a draft — a loop's pull request always is.`;

  return new ConflictError(
    RUN_PULL_REQUEST_ERRORS.draftRefused,
    message,
    "message" in details
      ? { host_message: details.message }
      : { url: details.url, number: details.number },
  );
}

/**
 * `502` — the host refused for any other reason.
 *
 * @param errorClass - The provider's classification (`auth`, `permission`, `rate_limit`, …).
 * @param message - The provider's own words.
 * @returns The error to throw.
 */
export function prCreateFailed(errorClass: string, message: string): UpstreamError {
  return new UpstreamError(
    RUN_PULL_REQUEST_ERRORS.prCreateFailed,
    `No pull request was opened: the host could not be asked to open it (${errorClass}).`,
    { error_class: errorClass, host_message: message },
  );
}
