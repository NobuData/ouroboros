import "server-only";

/**
 * One repository's detection card, read for the `/get-started` card's poll (BC.2,
 * [#391](https://github.com/NobuData/ouroboros/issues/391)) — BB.1's read (#384) through the
 * caller's session, with the poll family's deadline and its three answers (`app/api/poll-read.ts`).
 *
 * **Fast while a scan runs.** An answer whose scan is running asks to be read again every
 * {@link SCANNING_POLL_SECONDS} seconds, which is what moves the progress line and lands the new
 * scan without a reload; every other answer sets the family's default back, so the card does not
 * stay fast once the scan is done.
 */

import type { RepoDetection } from "@/app/api/detection";
import { detection } from "@/app/api/detection";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_DETECTION, isScanning } from "@/app/get-started/detection-view";
import { parseRepo } from "@/app/get-started/view";
import { DEFAULT_POLL_SECONDS, type PollAnswer } from "@/app/poll";

/** The code this hop reports under when the service could not be read. */
export const DETECTION_UNAVAILABLE_CODE = "detection_unavailable";

/** What a request naming no repository is answered — nothing is guessed on this hop. */
export const DETECTION_REPO_MISSING = "Name the repository: ?repo=owner/name.";

/** How often the card is read while a scan runs, in seconds. */
export const SCANNING_POLL_SECONDS = 2;

/**
 * One read of a repository's detection card.
 *
 * @param repo The repository the request named.
 * @param read How to read it. Defaults to the service through the request's session.
 * @returns The poll's answer — a failure, never a guess, for a repository that is not one.
 */
export async function readDetectionPoll(
  repo: string | null | undefined,
  read: (repo: string, signal: AbortSignal) => Promise<RepoDetection> = (asked, signal) =>
    detection.read(asked, anonymousApi(), signal),
): Promise<PollAnswer<RepoDetection>> {
  const asked = parseRepo(repo);

  if (asked === null) {
    return {
      state: "failed",
      reason: DETECTION_REPO_MISSING,
      pollAfterSeconds: null,
    };
  }

  const answer = await readForPoll((signal) => read(asked, signal), UNREACHABLE_DETECTION);

  if (answer.state !== "fresh") return answer;

  return {
    ...answer,
    pollAfterSeconds: isScanning(answer.payload.progress)
      ? SCANNING_POLL_SECONDS
      : DEFAULT_POLL_SECONDS,
  };
}
