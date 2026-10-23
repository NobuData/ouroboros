/**
 * Step 4's readiness poll (DK.2, [#1319](https://github.com/NobuData/ouroboros/issues/1319)) — the
 * preflight re-read on the poll family's cadence, and at once when the tab comes back, so a person
 * who left to enrol a runner or fix a token returns to an updated card without restarting the
 * wizard.
 */

import type { LoopReadiness } from "@/app/api/loop";
import { type Poll, type PollOptions, createPoll, requestPayload } from "@/app/poll";

import { UNREACHABLE_READINESS, UNREADABLE_READINESS, isLoopReadiness } from "./readiness-view";

/** How to build the poll. Everything is optional; production supplies none of it. */
export interface ReadinessPollOptions extends PollOptions {
  /** How to make one read of an endpoint. Defaults to {@link requestReadiness}. */
  read?: (endpoint: string, etag: string | null) => ReturnType<typeof requestReadiness>;
}

/**
 * One read of the preflight on this origin.
 *
 * @param endpoint The endpoint, with its query.
 * @param etag The last answer's entity tag, or null.
 * @returns The poll's answer.
 */
export function requestReadiness(endpoint: string, etag: string | null) {
  return requestPayload(endpoint, etag, isLoopReadiness, {
    unreachable: UNREACHABLE_READINESS,
    unreadable: UNREADABLE_READINESS,
  });
}

/**
 * Build the poll for one repository, workflow and issue.
 *
 * @param endpoint The endpoint ({@link readinessEndpoint}).
 * @param options A stubbed reader, a fake clock — the test seams.
 * @returns The poll, not yet started.
 */
export function createReadinessPoll(endpoint: string, options: ReadinessPollOptions = {}): Poll<LoopReadiness> {
  const read = options.read ?? requestReadiness;

  return createPoll((etag) => read(endpoint, etag), options);
}
