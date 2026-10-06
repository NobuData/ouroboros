import "server-only";

/**
 * One repository's right column, read for the `/get-started` column's poll (BC.5,
 * [#394](https://github.com/NobuData/ouroboros/issues/394)) — BB.5's defaults, claims and
 * projection (#388) through the caller's session, with the poll family's deadline and its three
 * answers (`app/api/poll-read.ts`).
 */

import { type OnboardingDefaults, onboarding } from "@/app/api/onboarding";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_DEFAULTS } from "@/app/get-started/defaults-view";
import { parseRepo } from "@/app/get-started/view";
import type { PollAnswer } from "@/app/poll";

/** The code this hop reports under when the service could not be read. */
export const DEFAULTS_UNAVAILABLE_CODE = "onboarding_defaults_unavailable";

/** What a request naming no repository is answered — nothing is guessed on this hop. */
export const DEFAULTS_REPO_MISSING = "Name the repository: ?repo=owner/name.";

/**
 * One read of a repository's column.
 *
 * @param repo The repository the request named.
 * @param read How to read it. Defaults to the service through the request's session.
 * @returns The poll's answer — a failure, never a guess, for a repository that is not one.
 */
export async function readDefaultsPoll(
  repo: string | null | undefined,
  read: (repo: string, signal: AbortSignal) => Promise<OnboardingDefaults> = (asked, signal) =>
    onboarding.defaults(asked, anonymousApi(), signal),
): Promise<PollAnswer<OnboardingDefaults>> {
  const asked = parseRepo(repo);

  if (asked === null) {
    return { state: "failed", reason: DEFAULTS_REPO_MISSING, pollAfterSeconds: null };
  }

  return readForPoll((signal) => read(asked, signal), UNREACHABLE_DEFAULTS);
}
