import "server-only";

/**
 * The run console's read, as the poll route answers it
 * ([#309](https://github.com/NobuData/ouroboros/issues/309)).
 *
 * `app/api/backlog-detail.ts` is the same file for one issue: the route handler at
 * `app/api/runs/[id]/route.ts` hands this answer to `pollResponse`, and the browser's loop
 * (`app/runs/console-poll.ts`) reads it back. The cadence is the shared I.8 default
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)) — nothing here overrides it.
 */

import { readForPoll } from "@/app/api/poll-read";
import { type RunConsole, runs } from "@/app/api/runs";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_RUN } from "@/app/runs/console-poll";
import type { PollAnswer } from "@/app/poll";

/** The code a failed read is answered with, when the service could not be read at all. */
export const RUN_UNAVAILABLE_CODE = "run_unavailable";

/**
 * Read one run for the poll.
 *
 * @param id The run's id.
 * @param read How to read it. Replaced in tests; production reads through the anonymous
 *   client, which forwards the browser's session.
 * @returns The poll's answer — never a throw.
 */
export async function readRunConsole(
  id: string,
  read: (id: string, signal: AbortSignal) => Promise<RunConsole> = (asked, signal) =>
    runs.console(asked, anonymousApi(), signal),
): Promise<PollAnswer<RunConsole>> {
  return readForPoll((signal) => read(id, signal), UNREACHABLE_RUN);
}
