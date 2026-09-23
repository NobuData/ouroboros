import "server-only";

/**
 * The transcript's tail, as the poll route answers it
 * ([#312](https://github.com/NobuData/ouroboros/issues/312)).
 *
 * `app/api/farm-log.ts` is the same file for a build's log: the cursor comes from the browser's
 * query string and is checked here before anything is asked, and the cadence is the service's
 * own `pollAfter` — five seconds while the run is live, the shared cadence after.
 */

import { readForPoll } from "@/app/api/poll-read";
import { type RunEventsPage, isRunId, runs } from "@/app/api/runs";
import { anonymousApi } from "@/app/api/server";
import { readAfter } from "@/app/farm/log-poll";
import type { PollAnswer } from "@/app/poll";
import { BAD_TRANSCRIPT_CURSOR, UNREACHABLE_TRANSCRIPT } from "@/app/runs/transcript-poll";

/** The code a failed read is answered with. */
export const RUN_EVENTS_UNAVAILABLE_CODE = "run_events_unavailable";

/** What is said about an id that is not a run's. */
export const BAD_RUN_ID = "That is not a run id.";

/**
 * Read one page of a run's transcript for the poll.
 *
 * @param id The run's id, from the path.
 * @param after The raw `?after=`, or `null` for the start.
 * @param read How to read it. Replaced in tests.
 * @returns The page with the service's cadence, or why not — never a throw.
 */
export async function readRunEvents(
  id: string,
  after: string | null,
  read: (id: string, after: number, signal: AbortSignal) => Promise<RunEventsPage> = (
    asked,
    from,
    signal,
  ) => runs.events(asked, from, anonymousApi(), signal),
): Promise<PollAnswer<RunEventsPage>> {
  if (!isRunId(id)) return { state: "failed", reason: BAD_RUN_ID, pollAfterSeconds: null };

  const from = readAfter(after);
  if (from === null) return { state: "failed", reason: BAD_TRANSCRIPT_CURSOR, pollAfterSeconds: null };

  const answer = await readForPoll((signal) => read(id, from, signal), UNREACHABLE_TRANSCRIPT);

  return answer.state === "fresh"
    ? { ...answer, pollAfterSeconds: answer.payload.pollAfter }
    : answer;
}
