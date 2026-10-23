/**
 * The wizard's first-loop poll (BD.1, [#396](https://github.com/NobuData/ouroboros/issues/396)) —
 * the run, its pull request and how it stands, re-read on the poll family's cadence so stage
 * transitions appear as they happen.
 */

import { type Poll, type PollOptions, createPoll, requestPayload } from "@/app/poll";

import { type FirstLoop, UNREACHABLE_FIRST_LOOP, UNREADABLE_FIRST_LOOP, isFirstLoop } from "./first-loop-view";

/** How to build the poll. Everything is optional; production supplies none of it. */
export interface FirstLoopPollOptions extends PollOptions {
  /** How to make one read of an endpoint. Defaults to {@link requestFirstLoop}. */
  read?: (endpoint: string, etag: string | null) => ReturnType<typeof requestFirstLoop>;
}

/**
 * One read of the first loop on this origin.
 *
 * @param endpoint The endpoint, with its run.
 * @param etag The last answer's entity tag, or null.
 * @returns The poll's answer.
 */
export function requestFirstLoop(endpoint: string, etag: string | null) {
  return requestPayload(endpoint, etag, isFirstLoop, {
    unreachable: UNREACHABLE_FIRST_LOOP,
    unreadable: UNREADABLE_FIRST_LOOP,
  });
}

/**
 * Build the poll for one run.
 *
 * @param endpoint The endpoint (`firstLoopEndpoint`).
 * @param options A stubbed reader, a fake clock — the test seams.
 * @returns The poll, not yet started.
 */
export function createFirstLoopPoll(endpoint: string, options: FirstLoopPollOptions = {}): Poll<FirstLoop> {
  const read = options.read ?? requestFirstLoop;

  return createPoll((etag) => read(endpoint, etag), options);
}
