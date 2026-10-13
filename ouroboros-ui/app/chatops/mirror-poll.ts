/**
 * The channel mirror's poll (CA.2, [#542](https://github.com/NobuData/ouroboros/issues/542)).
 *
 * One loop per channel on the page's own family and cadence, re-reading the **latest** page so a
 * card published a moment ago shows without a reload. Earlier pages are not polled: they are
 * read once, when the reader asks for them, through the same route with a cursor.
 */

import type { ChatMirror } from "@/app/api/chatops-mirror";
import { type Poll, type PollAnswer, type PollOptions, createPoll, requestPayload } from "@/app/poll";

import { UNREACHABLE_MIRROR, UNREADABLE_MIRROR, isChatMirror, mirrorEndpoint } from "./view";

/** How the latest page is read — the route by default. */
export type MirrorReader = (channelId: string, etag: string | null) => Promise<PollAnswer<ChatMirror>>;

/** How an earlier page is read — the route, with a cursor, by default. */
export type MirrorEarlierReader = (channelId: string, before: string) => Promise<PollAnswer<ChatMirror>>;

/** The poll's options, with seams for both readers. */
export interface MirrorPollOptions extends PollOptions {
  /** How to read the latest page. Defaults to {@link requestMirror}. */
  read?: MirrorReader;
  /** How to read an earlier page. Defaults to {@link requestEarlierMirror}. */
  earlier?: MirrorEarlierReader;
}

/** The sentences a read that did not answer is reported in. */
const SENTENCES = { unreachable: UNREACHABLE_MIRROR, unreadable: UNREADABLE_MIRROR };

/**
 * Ask this origin for the latest page of a channel's mirror.
 *
 * @param channelId The channel.
 * @param etag The validator of the payload already held, or null.
 * @returns The answer.
 */
export function requestMirror(channelId: string, etag: string | null): Promise<PollAnswer<ChatMirror>> {
  return requestPayload(mirrorEndpoint(channelId), etag, isChatMirror, SENTENCES);
}

/**
 * Ask this origin for the page before a cursor.
 *
 * @param channelId The channel.
 * @param before The cursor — an `olderCursor`.
 * @returns The answer.
 */
export function requestEarlierMirror(channelId: string, before: string): Promise<PollAnswer<ChatMirror>> {
  return requestPayload(mirrorEndpoint(channelId, before), null, isChatMirror, SENTENCES);
}

/**
 * Build a channel's poll.
 *
 * @param channelId The channel.
 * @param options The readers and the poll's own seams.
 * @returns The poll, inert until started.
 */
export function createMirrorPoll(channelId: string, options: MirrorPollOptions = {}): Poll<ChatMirror> {
  const read = options.read ?? requestMirror;

  return createPoll((etag) => read(channelId, etag), options);
}
