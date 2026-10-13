/**
 * The Chat Ops page's poll (CA.1, [#541](https://github.com/NobuData/ouroboros/issues/541)).
 *
 * One loop for the connection and the channels, at the interval the route names, so a connection
 * Slack revoked — or a channel somebody else bound — shows without a reload.
 */

import { type Poll, type PollOptions, type PollReader, createPoll, requestPayload } from "@/app/poll";

import {
  CHATOPS_ENDPOINT,
  type ChatOpsPage,
  UNREACHABLE_CHATOPS,
  UNREADABLE_CHATOPS,
  isChatOpsPage,
} from "./view";

/** How the page is read — the route by default. */
export type ChatOpsReader = PollReader<ChatOpsPage>;

/** The poll's options, with a seam for the reader. */
export interface ChatOpsPollOptions extends PollOptions {
  /** How to read. Defaults to {@link requestChatOps}. */
  read?: ChatOpsReader;
}

/**
 * Ask this origin for the page.
 *
 * @param etag The validator of the payload already held, or null.
 * @returns The answer.
 */
export function requestChatOps(etag: string | null) {
  return requestPayload(CHATOPS_ENDPOINT, etag, isChatOpsPage, {
    unreachable: UNREACHABLE_CHATOPS,
    unreadable: UNREADABLE_CHATOPS,
  });
}

/**
 * Build the page's poll.
 *
 * @param options The reader and the poll's own seams.
 * @returns The poll, inert until started.
 */
export function createChatOpsPoll(options: ChatOpsPollOptions = {}): Poll<ChatOpsPage> {
  return createPoll(options.read ?? requestChatOps, options);
}
