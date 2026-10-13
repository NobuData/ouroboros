import "server-only";

/**
 * A channel's mirror, as the Chat Ops page reads it (CA.2,
 * [#542](https://github.com/NobuData/ouroboros/issues/542)): Ouroboros's own record of what it
 * published to a channel and what was invoked there — `chat_messages` and `chat_commands`
 * (BY.2, [#532](https://github.com/NobuData/ouroboros/issues/532)), merged and paged backwards.
 *
 * It is a **record**, never the conversation: nothing Slack holds is read here, and every word
 * an entry carries is the service's — recomposed from the stored row by the same card model the
 * Slack publisher renders. The page draws what it is handed and adds no sentence of its own.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import { readForPoll } from "@/app/api/poll-read";
import type { components } from "@/app/api/schema";
import { anonymousApi, api } from "@/app/api/server";
import { CHATOPS_POLL_SECONDS, UNREACHABLE_MIRROR } from "@/app/chatops/view";
import type { PollAnswer } from "@/app/poll";

/* ---------------------------------------------------------- the contract */

/** One page of a channel's mirror. */
export type ChatMirror = components["schemas"]["ChatMirror"];

/** One entry of the stream. */
export type ChatMirrorEntry = components["schemas"]["ChatMirrorEntry"];

/** A card Ouroboros published — an event, or a question. */
export type MirrorCard = components["schemas"]["ChatMirrorCard"];

/** How a card is drawn: the service's reading of what it reports. */
export type MirrorSeverity = MirrorCard["severity"];

/** One button of a card: its label and the in-app page it opens. */
export type MirrorAction = components["schemas"]["ChatMirrorAction"];

/** How a decision card came out: the answer, who gave it, and when. */
export type MirrorResolution = components["schemas"]["ChatMirrorResolution"];

/** A system line — one sentence between two rules. */
export type MirrorLine = components["schemas"]["ChatMirrorLine"];

/** A command somebody ran, with what it answered. */
export type MirrorCommand = components["schemas"]["ChatMirrorCommand"];

/** What a command said: plain text and at most one link. */
export type MirrorReply = components["schemas"]["ChatMirrorReply"];

/* ----------------------------------------------------------------- calls */

/** The route, as the contract names it. */
export const MIRROR_ROUTE = "/api/v1/chat/channels/{id}/mirror";

/** Which page of the mirror to read. */
export interface MirrorQuery {
  /** An `olderCursor`, for the page before it. The latest page when omitted. */
  readonly before?: string;
  /** How many entries, 1–100. The service's default (50) when omitted. */
  readonly limit?: number;
}

/** The channel mirror, as `ouroboros-rest` serves it. */
export const chatopsMirror = {
  /**
   * Read one page of a channel's mirror.
   *
   * @param id The channel — a `chat_channels` row.
   * @param query Which page.
   * @param client The client to call through. Defaults to the server-side one.
   * @param signal Aborts the read.
   * @returns The channel, and one page of its entries, oldest first.
   * @throws {ApiError} `404 chat_channel_not_found` for a channel that is not this workspace's.
   */
  async read(
    id: string,
    query: MirrorQuery = {},
    client: ApiClient = api(),
    signal?: AbortSignal,
  ): Promise<ChatMirror> {
    const asked: { before?: string; limit?: number } = {};

    if (query.before !== undefined && query.before !== "") asked.before = query.before;
    if (query.limit !== undefined) asked.limit = query.limit;

    return unwrap(await client.GET(MIRROR_ROUTE, { params: { path: { id }, query: asked }, signal }));
  },
};

/* ------------------------------------------------------------ for the poll */

/** The code this origin reports a failed mirror read under. */
export const MIRROR_UNAVAILABLE_CODE = "chatops_mirror_unavailable";

/** What is said when the request names no channel. */
export const MIRROR_CHANNEL_MISSING = "No channel was named.";

/**
 * Read a page of the mirror for the browser.
 *
 * @param channel The channel's id, as the address named it.
 * @param before The cursor, or null for the latest page.
 * @param read How to read it — the service's route by default; a test substitutes its own.
 * @returns The answer, asking to be asked again after one cadence.
 */
export async function readChatOpsMirror(
  channel: string | null,
  before: string | null,
  read: (id: string, query: MirrorQuery, signal: AbortSignal) => Promise<ChatMirror> = (id, query, signal) =>
    chatopsMirror.read(id, query, anonymousApi(), signal),
): Promise<PollAnswer<ChatMirror>> {
  if (channel === null || channel.trim() === "") {
    return { state: "failed", reason: MIRROR_CHANNEL_MISSING, pollAfterSeconds: null };
  }

  const query: MirrorQuery = before === null || before === "" ? {} : { before };
  const answer = await readForPoll((signal) => read(channel, query, signal), UNREACHABLE_MIRROR);

  return answer.state === "gone" ? answer : { ...answer, pollAfterSeconds: CHATOPS_POLL_SECONDS };
}
