import "server-only";

/**
 * A run's controls, as the poll route answers them
 * ([#310](https://github.com/NobuData/ouroboros/issues/310)).
 *
 * `app/api/run-console.ts` is the same file for the snapshot. What this adds is the cadence:
 * a chip that reads *sent* has to move to *acknowledged* in seconds, not on the shared
 * fifteen-second interval, so while any control is still on its way the answer asks for
 * {@link CONTROL_POLL_SECONDS}, and once none is it asks for the default again. The hint is
 * always sent, because the loop keeps the last one it heard.
 */

import { readForPoll } from "@/app/api/poll-read";
import { type RunControlList, runs } from "@/app/api/runs";
import { anonymousApi } from "@/app/api/server";
import { DEFAULT_POLL_SECONDS, type PollAnswer } from "@/app/poll";
import { UNREACHABLE_CONTROLS } from "@/app/runs/controls-poll";
import { isOutstanding } from "@/app/runs/controls";

/** The code a failed read is answered with, when the service could not be read at all. */
export const RUN_CONTROLS_UNAVAILABLE_CODE = "run_controls_unavailable";

/** How often the chips are refreshed while a control is still on its way, in seconds. */
export const CONTROL_POLL_SECONDS = 2;

/**
 * The interval to ask for after an answer.
 *
 * @param list The controls.
 * @returns {@link CONTROL_POLL_SECONDS} while one is `pending` or `delivered`, the shared
 *   default otherwise.
 */
export function controlsCadence(list: RunControlList): number {
  return list.controls.some(isOutstanding) ? CONTROL_POLL_SECONDS : DEFAULT_POLL_SECONDS;
}

/**
 * Read one run's controls for the poll.
 *
 * @param id The run's id.
 * @param read How to read them. Replaced in tests; production reads through the anonymous
 *   client, which forwards the browser's session.
 * @returns The poll's answer, carrying its cadence — never a throw.
 */
export async function readRunControls(
  id: string,
  read: (id: string, signal: AbortSignal) => Promise<RunControlList> = (asked, signal) =>
    runs.controls(asked, anonymousApi(), signal),
): Promise<PollAnswer<RunControlList>> {
  const answer = await readForPoll((signal) => read(id, signal), UNREACHABLE_CONTROLS);

  return answer.state === "fresh"
    ? { ...answer, pollAfterSeconds: controlsCadence(answer.payload) }
    : answer;
}
