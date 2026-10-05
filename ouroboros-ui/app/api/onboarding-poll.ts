import "server-only";

/**
 * One repository's wizard, read for the `/get-started` poll (BC.1,
 * [#390](https://github.com/NobuData/ouroboros/issues/390)) — BB.2's read through the caller's
 * session, with the poll family's deadline and its three answers (`app/api/poll-read.ts`).
 */

import { type Onboarding, onboarding } from "@/app/api/onboarding";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_ONBOARDING, parseRepo } from "@/app/get-started/view";
import type { PollAnswer } from "@/app/poll";

/** The code this hop reports under when the service could not be read. */
export const ONBOARDING_UNAVAILABLE_CODE = "onboarding_unavailable";

/** What a request naming no repository is answered — nothing is guessed on this hop. */
export const ONBOARDING_REPO_MISSING = "Name the repository: ?repo=owner/name.";

/**
 * One read of a repository's wizard.
 *
 * @param repo The repository the request named.
 * @param read How to read it. Defaults to the service through the request's session.
 * @returns The poll's answer — a failure, never a guess, for a repository that is not one.
 */
export async function readOnboardingPoll(
  repo: string | null | undefined,
  read: (repo: string, signal: AbortSignal) => Promise<Onboarding> = (asked, signal) =>
    onboarding.read(asked, anonymousApi(), signal),
): Promise<PollAnswer<Onboarding>> {
  const asked = parseRepo(repo);

  if (asked === null) {
    return { state: "failed", reason: ONBOARDING_REPO_MISSING, pollAfterSeconds: null };
  }

  return readForPoll((signal) => read(asked, signal), UNREACHABLE_ONBOARDING);
}
