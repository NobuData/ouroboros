import "server-only";

/**
 * The PR verification page's read, as its poll route answers it
 * ([#363](https://github.com/NobuData/ouroboros/issues/363)).
 *
 * `app/api/test-results-read.ts` is the same file for the test-results page: the route handler
 * hands this answer to `pollResponse`, and the browser's loop (`app/prs/poll.ts`) reads it back.
 * The cadence is the shared I.8 default ([#87](https://github.com/NobuData/ouroboros/issues/87))
 * — nothing here overrides it.
 */

import { readForPoll } from "@/app/api/poll-read";
import { type PullRequestPage, isPullRequestId, pullRequests } from "@/app/api/pull-requests";
import { anonymousApi } from "@/app/api/server";
import type { PollAnswer } from "@/app/poll";
import { UNREACHABLE_PAGE } from "@/app/prs/poll";

/** The code a failed page read is answered with. */
export const PR_UNAVAILABLE_CODE = "pull_request_unavailable";

/** What is said, before calling out, for a page asked of something that is not a PR id. */
export const PR_ID_INVALID = "That is not a pull request id.";

/**
 * Read a PR's page for the poll.
 *
 * @param prId The PR's id.
 * @param read How to read it. Replaced in tests; production reads through the anonymous client,
 *   which forwards the browser's session.
 * @returns The poll's answer — never a throw. An id that is not a uuid is refused here rather
 *   than put in the service's path, for the reason `isRunId` gives.
 */
export async function readPageForPoll(
  prId: string,
  read: (prId: string, signal: AbortSignal) => Promise<PullRequestPage> = (asked, signal) =>
    pullRequests.page(asked, anonymousApi(), signal),
): Promise<PollAnswer<PullRequestPage>> {
  if (!isPullRequestId(prId)) {
    return { state: "failed", reason: PR_ID_INVALID, pollAfterSeconds: null };
  }

  return readForPoll((signal) => read(prId, signal), UNREACHABLE_PAGE);
}
