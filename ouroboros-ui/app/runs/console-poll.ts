/**
 * The run console's poll — `app/poll.ts`'s loop over one run
 * ([#309](https://github.com/NobuData/ouroboros/issues/309)).
 *
 * `app/planning/batch-poll.ts` is the same file for one planning batch, and the argument is the
 * same: the page is the browser asking, on the shared I.8 cadence
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)), for the run it has open and drawing
 * the last answer — so the status pill, the model and the branch move without a reload.
 *
 * **Framework-free**, so the reader is a unit test against a stubbed `fetch`; the screen meets
 * it through `app/issues/use-keyed-poll.ts`.
 */

import type { RunConsole } from "@/app/api/runs";
import {
  type Poll,
  type PollOptions,
  type PollReader,
  createPoll,
  requestPayload,
} from "@/app/poll";

/** Where the browser asks — this origin. The run's id is the last segment. */
export const RUN_ENDPOINT = "/api/runs";

/** What is said when something answered and this client could not read it as a run. */
export const UNREADABLE_RUN = "The run could not be read.";

/** What is said when nothing answered at all — a dropped connection, a timeout. */
export const UNREACHABLE_RUN = "The run could not be reached.";

/** One read of the run, as the loop needs it. Replaced wholesale in tests. */
export type RunReader = PollReader<RunConsole>;

/** How to build the console's poll. Everything is optional; production supplies none of it. */
export interface RunPollOptions extends PollOptions {
  /** How to make one read. Defaults to {@link requestRun} over the poll's address. */
  read?: RunReader;
}

/**
 * The address the console polls for one run.
 *
 * @param id The run's id.
 * @returns {@link RUN_ENDPOINT} with the id as its last segment, encoded.
 */
export function runUrl(id: string): string {
  return `${RUN_ENDPOINT}/${encodeURIComponent(id)}`;
}

/**
 * Whether a parsed body is a run console snapshot.
 *
 * Structural rather than exhaustive: the head reaches for `asOf`, `run`, `head` and
 * `resources.wallClock`, and a body carrying those is the snapshot for every purpose the head
 * has.
 *
 * @param value A parsed response body.
 * @returns `true` when it can be read as a {@link RunConsole}.
 */
export function isRunConsole(value: unknown): value is RunConsole {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<RunConsole>;

  return (
    typeof candidate.asOf === "string" &&
    typeof candidate.run === "object" &&
    candidate.run !== null &&
    typeof candidate.run.id === "string" &&
    typeof candidate.head === "object" &&
    candidate.head !== null &&
    typeof candidate.head.loopSeq === "number" &&
    typeof candidate.resources === "object" &&
    candidate.resources !== null &&
    typeof candidate.resources.wallClock === "object" &&
    candidate.resources.wallClock !== null
  );
}

/**
 * A reader of one address, from the browser.
 *
 * @param url Where to ask — {@link runUrl}'s answer.
 * @returns The reader. It does not throw, for the reason `requestPayload` gives.
 */
export function requestRun(url: string): RunReader {
  return (etag) =>
    requestPayload(url, etag, isRunConsole, {
      unreachable: UNREACHABLE_RUN,
      unreadable: UNREADABLE_RUN,
    });
}

/**
 * Build the console's loop over one address.
 *
 * @param url Where to ask. Ignored when `options.read` is given.
 * @param options Test seams; production passes none.
 * @returns The poll. It is inert until `start` is called.
 */
export function createRunPoll(url: string, options: RunPollOptions = {}): Poll<RunConsole> {
  return createPoll(options.read ?? requestRun(url), options);
}
