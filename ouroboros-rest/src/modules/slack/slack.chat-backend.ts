/**
 * Slack, as a chat backend (BZ.2, [#536](https://github.com/NobuData/ouroboros/issues/536)).
 *
 * Implements `chat/chat.backend.ts` over the Slack Web API: renders the card model to Block Kit
 * (`slack.blockkit.ts`), posts and edits with the connection's bot token, and turns Slack's error
 * codes into the four things the publisher's outbox acts on.
 *
 * ```
 * ratelimited · unreachable · a 5xx · anything unrecognised     retry (after Retry-After, when given)
 * channel_not_found · not_in_channel · is_archived · …          gone — nowhere left to say it
 * invalid_auth · token_revoked · account_inactive · …           revoked — the connection is flipped
 * invalid_blocks · msg_too_long · message_not_found · …         rejected — this message never will
 * ```
 *
 * **The token is read per call and never kept.** A connection whose token cannot be unsealed is
 * a retry, not a rejection: the vault may be back the next time.
 */

import { Inject, Injectable } from "@nestjs/common";

import type {
  ChatBackend,
  ChatRendered,
  ChatSendFailure,
  ChatSendResult,
} from "../chat/chat.backend";
import type { ChatMessageModel } from "../chat/chat.card";
import { renderBlockKit } from "./slack.blockkit";
import {
  REVOKED_ERRORS,
  SLACK_API,
  type SlackApi,
  type SlackDelivery,
  type SlackMessage,
} from "./slack.client";
import { SlackInstallService } from "./slack.install.service";
import { SlackRepository } from "./slack.repository";

/** Errors that mean the destination takes no messages from this bot any more. */
export const GONE_ERRORS: ReadonlySet<string> = new Set([
  "channel_not_found",
  "not_in_channel",
  "is_archived",
  "user_not_found",
  "user_disabled",
  "cannot_dm_bot",
]);

/** Errors that mean this message will be refused however often it is sent. */
export const REJECTED_ERRORS: ReadonlySet<string> = new Set([
  "invalid_blocks",
  "invalid_blocks_format",
  "invalid_attachments",
  "invalid_arguments",
  "msg_too_long",
  "no_text",
  "too_many_attachments",
  "message_not_found",
  "cant_update_message",
  "edit_window_closed",
  "missing_scope",
  "restricted_action",
]);

/** What the backend reports when a connection's token cannot be read. */
export const TOKEN_UNREADABLE = "bot_token_unreadable";

@Injectable()
export class SlackChatBackend implements ChatBackend {
  /**
   * @param slack - The calls to Slack.
   * @param installs - Unseals a connection's token, and flips a connection Slack has revoked.
   * @param repository - Reads the connection a revocation is recorded against.
   */
  constructor(
    @Inject(SLACK_API) private readonly slack: SlackApi,
    private readonly installs: SlackInstallService,
    private readonly repository: SlackRepository,
  ) {}

  /** @inheritdoc */
  render(message: ChatMessageModel): ChatRendered {
    return renderBlockKit(message);
  }

  /** @inheritdoc */
  async post(input: {
    connectionId: string;
    channelId: string;
    rendered: ChatRendered;
  }): Promise<ChatSendResult<{ ts: string }>> {
    return this.withToken(input.connectionId, "chat.postMessage", (token) =>
      this.slack.postMessage(token, input.channelId, messageOf(input.rendered)),
    );
  }

  /** @inheritdoc */
  async update(input: {
    connectionId: string;
    channelId: string;
    ts: string;
    rendered: ChatRendered;
  }): Promise<ChatSendResult<{ ts: string }>> {
    return this.withToken(input.connectionId, "chat.update", (token) =>
      this.slack.updateMessage(token, input.channelId, input.ts, messageOf(input.rendered)),
    );
  }

  /** @inheritdoc */
  async openDm(input: {
    connectionId: string;
    platformUserId: string;
  }): Promise<ChatSendResult<{ channelId: string }>> {
    return this.withToken(input.connectionId, "conversations.open", (token) =>
      this.slack.openDm(token, input.platformUserId),
    );
  }

  /**
   * Make one call with a connection's token and classify its failure.
   *
   * @param connectionId - The connection.
   * @param method - The Web API method, for the audit entry of a revocation.
   * @param call - The call, given the token.
   * @returns The call's answer, or the failure as the outbox understands it.
   */
  private async withToken<T>(
    connectionId: string,
    method: string,
    call: (token: string) => Promise<SlackDelivery<T>>,
  ): Promise<ChatSendResult<T>> {
    const token = await this.installs.botToken(connectionId);

    if (token === undefined) {
      return { ok: false, error: TOKEN_UNREADABLE, reason: "retry" };
    }

    const answer = await call(token);

    if (answer.ok) {
      return answer;
    }

    if (REVOKED_ERRORS.has(answer.error)) {
      const connection = await this.repository.connection(connectionId);

      if (connection !== undefined) {
        await this.installs.noteFailure(connection, answer.error, method);
      }
    }

    return classify(answer);
  }
}

/**
 * A rendered message as the client takes it.
 *
 * @param rendered - What {@link renderBlockKit} produced.
 * @returns The text, blocks and attachments.
 */
function messageOf(rendered: ChatRendered): SlackMessage {
  const payload = rendered.payload as { blocks?: unknown[]; attachments?: unknown[] };

  return { text: rendered.text, blocks: payload.blocks, attachments: payload.attachments };
}

/**
 * Classify one of Slack's failures.
 *
 * @param failure - Slack's error code and, for a rate limit, its `Retry-After`.
 * @returns The failure with the reason the outbox acts on. An error this does not recognise is a
 *   retry: giving up on something that would have worked is the worse mistake.
 */
export function classify(failure: { error: string; retryAfterSeconds?: number }): ChatSendFailure {
  const reason = REVOKED_ERRORS.has(failure.error)
    ? "revoked"
    : GONE_ERRORS.has(failure.error)
      ? "gone"
      : REJECTED_ERRORS.has(failure.error)
        ? "rejected"
        : "retry";

  return {
    ok: false,
    error: failure.error,
    reason,
    ...(failure.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: failure.retryAfterSeconds }),
  };
}
