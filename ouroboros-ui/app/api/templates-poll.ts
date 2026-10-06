import "server-only";

/**
 * One repository's template tiles, read for the `/get-started` card's poll (BC.3,
 * [#392](https://github.com/NobuData/ouroboros/issues/392)) — BB.3's read (#386) through the
 * caller's session, with the poll family's deadline and its three answers (`app/api/poll-read.ts`).
 */

import { type OnboardingTemplateTiles, onboarding } from "@/app/api/onboarding";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_TEMPLATES } from "@/app/get-started/templates-view";
import { parseRepo } from "@/app/get-started/view";
import type { PollAnswer } from "@/app/poll";

/** The code this hop reports under when the service could not be read. */
export const TEMPLATES_UNAVAILABLE_CODE = "templates_unavailable";

/** What a request naming no repository is answered — nothing is guessed on this hop. */
export const TEMPLATES_REPO_MISSING = "Name the repository: ?repo=owner/name.";

/**
 * One read of a repository's tiles.
 *
 * @param repo The repository the request named.
 * @param read How to read it. Defaults to the service through the request's session.
 * @returns The poll's answer — a failure, never a guess, for a repository that is not one.
 */
export async function readTemplatesPoll(
  repo: string | null | undefined,
  read: (repo: string, signal: AbortSignal) => Promise<OnboardingTemplateTiles> = (asked, signal) =>
    onboarding.templates(asked, anonymousApi(), signal),
): Promise<PollAnswer<OnboardingTemplateTiles>> {
  const asked = parseRepo(repo);

  if (asked === null) {
    return { state: "failed", reason: TEMPLATES_REPO_MISSING, pollAfterSeconds: null };
  }

  return readForPoll((signal) => read(asked, signal), UNREACHABLE_TEMPLATES);
}
