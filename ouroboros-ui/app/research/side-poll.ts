/**
 * The Research side column's poll (CN.3, [#629](https://github.com/NobuData/ouroboros/issues/629)).
 *
 * One loop for both cards, at the interval the route names — the health cycle — so a tool that
 * goes down, or a watch item that moves on, shows without a reload.
 */

import { type Poll, type PollOptions, type PollReader, createPoll, requestPayload } from "@/app/poll";

import {
  RESEARCH_SIDE_ENDPOINT,
  type ResearchSide,
  UNREACHABLE_SIDE,
  UNREADABLE_SIDE,
  isResearchSide,
} from "./side";

/** How the side column is read — the route by default. */
export type SideReader = PollReader<ResearchSide>;

/** The poll's options, with a seam for the reader. */
export interface SidePollOptions extends PollOptions {
  /** How to read. Defaults to {@link requestSide}. */
  read?: SideReader;
}

/**
 * Ask this origin for the side column.
 *
 * @param etag The validator of the payload already held, or null.
 * @returns The answer.
 */
export function requestSide(etag: string | null) {
  return requestPayload(RESEARCH_SIDE_ENDPOINT, etag, isResearchSide, {
    unreachable: UNREACHABLE_SIDE,
    unreadable: UNREADABLE_SIDE,
  });
}

/**
 * Build the side column's poll.
 *
 * @param options The reader and the poll's own seams.
 * @returns The poll, inert until started.
 */
export function createSidePoll(options: SidePollOptions = {}): Poll<ResearchSide> {
  return createPoll(options.read ?? requestSide, options);
}
