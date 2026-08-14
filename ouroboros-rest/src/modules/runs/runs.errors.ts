/**
 * Every code the runs API can answer with — which is one
 * ([#71](https://github.com/NobuData/ouroboros/issues/71)).
 *
 * The same contract `tenancy.errors.ts` keeps: the string in the specification and the
 * string in the answer come from one constant, `runs.errors.spec.ts` holds the two together,
 * and the message is written for a person — it names no table, no column, and no fact the
 * caller did not already send.
 */

import { NotFoundError } from "../errors/error.envelope";

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
