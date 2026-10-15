import "server-only";

import { type LoopCapabilities, loop } from "@/app/api/loop";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_CAPABILITIES } from "@/app/shell/loop-capabilities";
import type { PollAnswer } from "@/app/poll";

/** The code a failed read answers with, through `/api/loop/capabilities`. */
export const LOOP_CAPABILITIES_UNAVAILABLE_CODE = "loop_capabilities_unavailable";

/**
 * Read the capability report for the shell's poll (DG.3, #1301).
 *
 * @param read The read itself; the REST client unless a test stands one in.
 * @returns The poll's answer.
 */
export async function readLoopCapabilities(
  read: (signal: AbortSignal) => Promise<LoopCapabilities> = (signal) =>
    loop.capabilities(anonymousApi(), signal),
): Promise<PollAnswer<LoopCapabilities>> {
  return readForPoll(read, UNREACHABLE_CAPABILITIES);
}
