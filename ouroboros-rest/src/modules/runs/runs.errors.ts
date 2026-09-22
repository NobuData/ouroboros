/**
 * Every code the runs API can answer with — `run_not_found` since
 * [#71](https://github.com/NobuData/ouroboros/issues/71), and the transcript cursor's refusal since
 * [#304](https://github.com/NobuData/ouroboros/issues/304).
 *
 * The same contract `tenancy.errors.ts` keeps: the string in the specification and the
 * string in the answer come from one constant, `runs.errors.spec.ts` holds the two together,
 * and the message is written for a person — it names no table, no column, and no fact the
 * caller did not already send.
 */

import { InvalidRequestError, NotFoundError } from "../errors/error.envelope";

/** The codes, as one object — see `tenancy.errors.ts` for why `as const` matters. */
export const RUNS_ERRORS = {
  /**
   * No run with that id — *or* none this caller may know about.
   *
   * The two are deliberately one answer, the acceptance criterion the ticket states
   * outright: a run id belonging to another organization returns `404`, not `403`, because
   * a `403` confirms that an identifier names something real — which is the whole of what
   * somebody enumerating uuids is trying to learn.
   */
  runNotFound: "run_not_found",
  /**
   * A transcript cursor past the end of the transcript (AP.2).
   *
   * `seq` is dense and never reused, so a cursor the server handed out is always at or below
   * the run's latest sequence number. One above it was not handed out by this service — a
   * client that confused two runs, or invented a number — and answering it with an empty page
   * would leave that client waiting at a cursor no entry will ever pass.
   */
  eventsCursorOutOfRange: "run_events_cursor_out_of_range",
} as const;

/**
 * `404` — the run does not exist for this caller.
 *
 * @param id - The id the request named. Echoed into `details.runId` because the caller sent
 *   it and a screen holding several runs open needs to know which request failed.
 * @returns The error to throw.
 */
export function runNotFound(id: string): NotFoundError {
  return new NotFoundError(RUNS_ERRORS.runNotFound, "No such run.", { runId: id });
}

/**
 * `422` — `?after=` is past the end of the run's transcript.
 *
 * @param latestSeq - The run's highest sequence number, echoed so the client can resume from a
 *   cursor that exists.
 * @returns The error to throw.
 */
export function eventsCursorOutOfRange(latestSeq: number): InvalidRequestError {
  return new InvalidRequestError(
    RUNS_ERRORS.eventsCursorOutOfRange,
    `This transcript holds ${String(latestSeq)} entries; there is nothing after that.`,
    { latestSeq },
  );
}
