import "server-only";

/**
 * The Chat Ops page, read for its poll (CA.1,
 * [#541](https://github.com/NobuData/ouroboros/issues/541)): the Slack connection and the
 * workspace's channels — and, since CA.3
 * ([#543](https://github.com/NobuData/ouroboros/issues/543)), the `/ouro` grammar, the
 * notification routes and the on-call designee — as one payload.
 *
 * One ask rather than several because they are one subject: a connection Slack revoked, a
 * channel that lost its binding and a route somebody repointed in Settings are all *this page is
 * out of date*, and one loop keeps the strip, the lists and the cards in step. The answer names its own interval, so the browser asks again
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
 * @param read How to read it — the service's routes by default; a test substitutes its own.
 * @returns The answer, asking to be asked again after one cadence.
 */
export async function readChatOpsPage(
  read: (signal: AbortSignal) => Promise<ChatOpsPage> = (signal) => loadChatOps(anonymousApi(), signal),
): Promise<PollAnswer<ChatOpsPage>> {
  const answer = await readForPoll(read, UNREACHABLE_CHATOPS);

  return answer.state === "gone" ? answer : { ...answer, pollAfterSeconds: CHATOPS_POLL_SECONDS };
}
