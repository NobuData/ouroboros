import "server-only";

/**
 * The Chat Ops page, read for its poll (CA.1,
 * [#541](https://github.com/NobuData/ouroboros/issues/541)): the Slack connection and the
 * workspace's channels, as one payload.
 *
 * One ask rather than two because the two are one subject: a connection Slack revoked and a
 * channel that lost its binding are both *this page is out of date*, and one loop keeps the
 * strip and the lists in step. The answer names its own interval, so the browser asks again
 * after it.
 */

import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { loadChatOps } from "@/app/chatops/chatops-data";
import { CHATOPS_POLL_SECONDS, type ChatOpsPage, UNREACHABLE_CHATOPS } from "@/app/chatops/view";
import type { PollAnswer } from "@/app/poll";

/** The code this origin reports a failed read under. */
export const CHATOPS_UNAVAILABLE_CODE = "chatops_unavailable";

/**
 * Read the page for a poll.
 *
 * @param read How to read it — the service's two routes by default; a test substitutes its own.
 * @returns The answer, asking to be asked again after one cadence.
 */
export async function readChatOpsPage(
  read: (signal: AbortSignal) => Promise<ChatOpsPage> = (signal) => loadChatOps(anonymousApi(), signal),
): Promise<PollAnswer<ChatOpsPage>> {
  const answer = await readForPoll(read, UNREACHABLE_CHATOPS);

  return answer.state === "gone" ? answer : { ...answer, pollAfterSeconds: CHATOPS_POLL_SECONDS };
}
