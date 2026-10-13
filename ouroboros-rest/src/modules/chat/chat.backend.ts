/**
 * The port between the card model and a chat platform (BZ.2,
 * [#536](https://github.com/NobuData/ouroboros/issues/536)).
 *
 * The publisher composes a {@link ChatMessageModel}, asks the backend to render it, and asks it
 * to post or edit what it rendered. It never sees a block, a token or a platform's error
 * vocabulary: a failure comes back classified — try again (after how long), give up, or the
 * install is over — and that is all the outbox needs to know.
 *
 * Slack's implementation is `slack/slack.chat-backend.ts`. `chat.fixture.ts` holds a second one,
 * which renders plain text, so the specs prove the port has no Slack in it.
 */

import type { ChatMessageModel } from "./chat.card";

/** The injection token for the {@link ChatBackend}. */
export const CHAT_BACKEND = Symbol("CHAT_BACKEND");

/** A message as a platform takes it. */
export interface ChatRendered {
  /** The plain-text form: a notification's text and the fallback where the payload cannot draw. */
  readonly text: string;
  /** The platform's own payload. Opaque to the publisher; JSON-serialisable, for the digest. */
  readonly payload: unknown;
}

/** Why a send did not happen. */
export interface ChatSendFailure {
  readonly ok: false;
  /** The platform's error code, or a short description. */
  readonly error: string;
  /**
   * - `retry` — transient: the network, a 5xx, a rate limit.
   * - `gone` — the destination no longer takes messages (the bot left, the channel is archived).
   * - `revoked` — the install is over; the backend has already recorded that.
   * - `rejected` — the platform refused this message and always will.
   */
  readonly reason: "retry" | "gone" | "revoked" | "rejected";
  /** How long the platform asked to be left alone, when it said. */
  readonly retryAfterSeconds?: number;
}

/** A send's answer. */
export type ChatSendResult<T> = ({ readonly ok: true } & T) | ChatSendFailure;

/** The calls. */
export interface ChatBackend {
  /**
   * Render a message for this platform.
   *
   * @param message - The card or line.
   * @returns Its payload and plain-text form. Pure: the same model renders the same payload.
   */
  render(message: ChatMessageModel): ChatRendered;

  /**
   * Post a new message.
   *
   * @param input.connectionId - The connection to post through.
   * @param input.channelId - The platform's id for the channel or DM conversation.
   * @param input.rendered - What {@link render} produced.
   * @returns The platform's timestamp for the message — what an edit addresses.
   */
  post(input: {
    connectionId: string;
    channelId: string;
    rendered: ChatRendered;
  }): Promise<ChatSendResult<{ ts: string }>>;

  /**
   * Edit a message in place.
   *
   * @param input.connectionId - The connection.
   * @param input.channelId - The platform's id for the channel.
   * @param input.ts - The message's timestamp, from {@link post}.
   * @param input.rendered - What it should now say.
   * @returns The timestamp again.
   */
  update(input: {
    connectionId: string;
    channelId: string;
    ts: string;
    rendered: ChatRendered;
  }): Promise<ChatSendResult<{ ts: string }>>;

  /**
   * Open a direct-message conversation with one person.
   *
   * @param input.connectionId - The connection.
   * @param input.platformUserId - The person, as the platform names them.
   * @returns The platform's id for the conversation, to post to.
   */
  openDm(input: {
    connectionId: string;
    platformUserId: string;
  }): Promise<ChatSendResult<{ channelId: string }>>;
}
