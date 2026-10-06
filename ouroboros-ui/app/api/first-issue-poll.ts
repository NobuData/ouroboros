import "server-only";

/**
 * One repository's first-issue card, read for the `/get-started` card's poll (BC.4,
 * [#393](https://github.com/NobuData/ouroboros/issues/393)) — BB.4's pick and ranking (#387) and
 * the dry-run policy (BA.3, #382) through the caller's session, with the poll family's deadline
 * and its three answers (`app/api/poll-read.ts`).
 */

import { type FirstIssueCard, readFirstIssueCard } from "@/app/api/onboarding";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_FIRST_ISSUE } from "@/app/get-started/first-issue-view";
import { parseRepo } from "@/app/get-started/view";
import type { PollAnswer } from "@/app/poll";

/** The code this hop reports under when the service could not be read. */
export const FIRST_ISSUE_UNAVAILABLE_CODE = "first_issue_unavailable";

/** What a request naming no repository is answered — nothing is guessed on this hop. */
export const FIRST_ISSUE_REPO_MISSING = "Name the repository: ?repo=owner/name.";

/**
 * One read of a repository's card.
 *
 * @param repo The repository the request named.
 * @param read How to read it. Defaults to the service through the request's session.
 * @returns The poll's answer — a failure, never a guess, for a repository that is not one.
 */
export async function readFirstIssuePoll(
  repo: string | null | undefined,
  read: (repo: string, signal: AbortSignal) => Promise<FirstIssueCard> = (asked, signal) =>
    readFirstIssueCard(asked, anonymousApi(), signal),
): Promise<PollAnswer<FirstIssueCard>> {
  const asked = parseRepo(repo);

  if (asked === null) {
    return { state: "failed", reason: FIRST_ISSUE_REPO_MISSING, pollAfterSeconds: null };
  }

  return readForPoll((signal) => read(asked, signal), UNREACHABLE_FIRST_ISSUE);
}
