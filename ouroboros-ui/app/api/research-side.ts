import "server-only";

/**
 * The Research side column, read for its poll (CN.3,
 * [#629](https://github.com/NobuData/ouroboros/issues/629)): the tools catalog — with each
 * tool's health re-asked — and the regression watch card, as one payload.
 *
 * One ask rather than two because the two cards share a cycle: a tool going down and a drift
 * moving on are both *the side column is out of date*, and one loop keeps them in step. The
 * answer names its own interval — the health cycle — so the browser asks again after it.
 */

import { readForPoll } from "@/app/api/poll-read";
import { research } from "@/app/api/research";
import { anonymousApi } from "@/app/api/server";
import type { PollAnswer } from "@/app/poll";
import { HEALTH_CYCLE_SECONDS, type ResearchSide, UNREACHABLE_SIDE } from "@/app/research/side";

/** The code this origin reports a failed side read under. */
export const RESEARCH_SIDE_UNAVAILABLE_CODE = "research_side_unavailable";

/**
 * Read both cards from the service.
 *
 * @param signal The poll's deadline.
 * @returns The tools catalog and the watch card.
 */
async function readBoth(signal: AbortSignal): Promise<ResearchSide> {
  const client = anonymousApi();
  const [tools, watch] = await Promise.all([research.tools(client, signal), research.watch(client, signal)]);

  return { tools, watch };
}

/**
 * Read the side column for a poll.
 *
 * @param read How to read it — the service's two routes by default; a test substitutes its own.
 * @returns The answer, asking to be asked again after one health cycle.
 */
export async function readResearchSide(
  read: (signal: AbortSignal) => Promise<ResearchSide> = readBoth,
): Promise<PollAnswer<ResearchSide>> {
  const answer = await readForPoll(read, UNREACHABLE_SIDE);

  return answer.state === "gone" ? answer : { ...answer, pollAfterSeconds: HEALTH_CYCLE_SECONDS };
}
