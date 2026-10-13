/**
 * The command trail's reads and writes (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)) over V131's `chat_commands` and
 * `chat_messages` — the REST layer #532 created the tables for and left unbuilt.
 *
 * ```
 * record   one transaction: the reply's message row (when the channel is one of ours), then the
 *          command row naming it in result_ref
 * settle   async_pending → ok | error, with completed_at — and only from pending
 * audit    the command's audit event id, once the event exists
 * ```
 *
 * **Only rows V131 accepts.** `outcome = 'error'` always carries `error_detail`; `ok` and
 * `async_pending` never do; `completed_at` is null exactly while pending; a Slack row always
 * carries the platform user. {@link CommandRecord} is shaped so a caller cannot build the
 * combinations the CHECKs refuse, and `chatops.repository.spec.ts` holds each write to them.
 *
 * **What a reply's message row holds, and what it does not.** A `command_reply` row is facts,
 * never prose (V131), and a command's reply here is a sentence — so the row carries no `facts`
 * and no `refs`: it says *a reply was given, in this channel, at this time, to this command*
 * (`chat_commands.result_ref.message`), and its `payload_digest` is the seed's
 * `sha256('command_reply:' || command id)`. `platform_ts` stays null: a reply sent to a
 * `response_url` is never given one. Only a channel the connection has **joined** gets a row —
 * a DM or a channel the app is not in is not a `chat_channels` row the mirror draws, and
 * `chat_commands.channel_id` stays null there.
 *
 * **Nothing here deletes.** The application role holds no `delete` on either table.
 */

import { createHash, randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { ChatCommandSurface } from "../db/schema";

/** `chat_commands.raw_text`'s length bound (V131). */
export const RAW_TEXT_LIMIT = 4000;

/** `chat_commands.error_detail`'s length bound (V131). */
export const ERROR_DETAIL_LIMIT = 2000;

/** How a recorded command ended — each variant is a combination V131's CHECKs accept. */
export type RecordedOutcome =
  | { readonly outcome: "ok" }
  | { readonly outcome: "async_pending" }
  | { readonly outcome: "denied" }
  | { readonly outcome: "unlinked" }
  /** `detail` is the short stable reason — `unknown_command`, a plane's error code. */
  | { readonly outcome: "error"; readonly detail: string };

/** One invocation, as it is written. */
export interface CommandRecord {
  /** Chosen by the caller, so the reply's digest and the audit event can name it. */
  readonly id: string;
  readonly organizationId: string;
  readonly connectionId: string;
  /** The `chat_channels` row, when the channel is one the connection has joined. */
  readonly channelId: string | null;
  /** The invoker's identity link; null for an unlinked attempt. */
  readonly invokerLinkId: string | null;
  /** The platform's user id — required on the slack surface. */
  readonly platformUserId: string;
  readonly surface: Extract<ChatCommandSurface, "slack">;
  /** The command's id — matching `chat_commands_command_present`. */
  readonly command: string;
  /** The arguments as parsed, by name. */
  readonly args: Readonly<Record<string, string | number | boolean>>;
  /** The text as typed, with its prefix. */
  readonly rawText: string;
  readonly ended: RecordedOutcome;
  /** What the binding said it made or changed. */
  readonly ref?: Readonly<Record<string, string | number>>;
  readonly invokedAt: Date;
  /** When it finished — ignored for `async_pending`, which has not. */
  readonly completedAt: Date;
  /** Whether the reply is recorded as a message. Needs {@link channelId}. */
  readonly withReplyMessage: boolean;
}

/** What {@link ChatopsRepository.record} wrote. */
export interface RecordedCommand {
  readonly id: string;
  /** The reply's `chat_messages` row, when one was written. */
  readonly messageId: string | null;
}

/**
 * The digest a command's reply is deduplicated by — the seed's shape.
 *
 * @param commandId - The command.
 * @param part - `reply` for the first reply; `result` for an async command's later one, which
 *   is a second message and must not collide with the first.
 * @returns SHA-256, hex.
 */
export function replyDigest(commandId: string, part: "reply" | "result"): string {
  const subject =
    part === "reply" ? `command_reply:${commandId}` : `command_reply:${commandId}:result`;

  return createHash("sha256").update(subject, "utf8").digest("hex");
}

/**
 * Text bounded to a column's length.
 *
 * @param text - The text.
 * @param limit - The column's bound.
 * @returns The text, cut to fit.
 */
function bounded(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

@Injectable()
export class ChatopsRepository {
  /** @param database - The typed connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The workspace's row for a platform channel — only when the connection has joined it.
   *
   * @param connectionId - The connection the command came through.
   * @param platformChannelId - The platform's channel id (`C071LOOPS`).
   * @returns The `chat_channels` id, or `undefined` for a DM, an unknown or an un-joined channel.
   */
  async joinedChannel(
    connectionId: string,
    platformChannelId: string,
  ): Promise<string | undefined> {
    const row = await this.database.db
      .selectFrom("chat_channels")
      .select("id")
      .where("connection_id", "=", connectionId)
      .where("channel_id", "=", platformChannelId)
      .where("joined", "=", true)
      .executeTakeFirst();

    return row?.id;
  }

  /**
   * The name a person is recorded under by the planes.
   *
   * @param userId - `"user".id`.
   * @returns Their name, or `undefined` when the person no longer exists.
   */
  async userName(userId: string): Promise<string | undefined> {
    const row = await this.database.db
      .selectFrom("user")
      .select("name")
      .where("id", "=", userId)
      .executeTakeFirst();

    return row?.name;
  }

  /**
   * A workspace's name, for a sentence that says where something would happen.
   *
   * @param organizationId - The workspace.
   * @returns Its name, or `undefined`.
   */
  async workspaceName(organizationId: string): Promise<string | undefined> {
    const row = await this.database.db
      .selectFrom("organization")
      .select("name")
      .where("id", "=", organizationId)
      .executeTakeFirst();

    return row?.name;
  }

  /**
   * Record one invocation — and its reply as a message, when asked and the channel is known.
   *
   * One transaction: a command that names a message it does not have, or a reply with no
   * command, is never left behind.
   *
   * @param command - The invocation.
   * @returns The command's id and its reply message's, if one was written.
   */
  async record(command: CommandRecord): Promise<RecordedCommand> {
    const pending = command.ended.outcome === "async_pending";
    const messageId = command.withReplyMessage && command.channelId !== null ? randomUUID() : null;
    const channelId = command.channelId;
    const produced = { ...command.ref, ...(messageId === null ? {} : { message: messageId }) };

    await this.database.db.transaction().execute(async (transaction) => {
      if (messageId !== null && channelId !== null) {
        await transaction
          .insertInto("chat_messages")
          .values({
            id: messageId,
            organization_id: command.organizationId,
            channel_id: channelId,
            kind: "command_reply",
            payload_digest: replyDigest(command.id, "reply"),
            // The reply is given when the work is done; for a pending command, at its ack.
            posted_at: command.completedAt,
          })
          .execute();
      }

      await transaction
        .insertInto("chat_commands")
        .values({
          id: command.id,
          organization_id: command.organizationId,
          connection_id: command.connectionId,
          channel_id: channelId,
          invoker_link_id: command.invokerLinkId,
          platform_user_id: command.platformUserId,
          surface: command.surface,
          command: command.command,
          args: JSON.stringify(command.args),
          raw_text: bounded(command.rawText, RAW_TEXT_LIMIT),
          outcome: command.ended.outcome,
          result_ref: Object.keys(produced).length === 0 ? null : JSON.stringify(produced),
          error_detail:
            command.ended.outcome === "error"
              ? bounded(command.ended.detail.trim(), ERROR_DETAIL_LIMIT)
              : null,
          invoked_at: command.invokedAt,
          completed_at: pending ? null : command.completedAt,
        })
        .execute();
    });

    return { id: command.id, messageId };
  }

  /**
   * Settle a pending command: its result arrived, or failed to.
   *
   * Only a row still `async_pending` moves, so a result that settles twice — or after a
   * restart's sweep — changes nothing the second time. The result is its own message: when the
   * command was typed in a joined channel a second `command_reply` row is written and named in
   * `result_ref.result_message`.
   *
   * @param commandId - The command.
   * @param ended - `ok`, or `error` with its reason.
   * @param at - When it settled.
   * @returns `true` when the row moved; `false` when it was not pending (or does not exist).
   */
  async settle(
    commandId: string,
    ended: Extract<RecordedOutcome, { outcome: "ok" | "error" }>,
    at: Date,
  ): Promise<boolean> {
    return this.database.db.transaction().execute(async (transaction) => {
      const row = await transaction
        .selectFrom("chat_commands")
        .select(["organization_id", "channel_id", "result_ref"])
        .where("id", "=", commandId)
        .where("outcome", "=", "async_pending")
        .forUpdate()
        .executeTakeFirst();

      if (row === undefined) {
        return false;
      }

      let produced = row.result_ref;

      if (row.channel_id !== null) {
        const messageId = randomUUID();

        await transaction
          .insertInto("chat_messages")
          .values({
            id: messageId,
            organization_id: row.organization_id,
            channel_id: row.channel_id,
            kind: "command_reply",
            payload_digest: replyDigest(commandId, "result"),
            posted_at: at,
          })
          .execute();

        produced = { ...produced, result_message: messageId };
      }

      await transaction
        .updateTable("chat_commands")
        .set({
          outcome: ended.outcome,
          error_detail:
            ended.outcome === "error" ? bounded(ended.detail.trim(), ERROR_DETAIL_LIMIT) : null,
          completed_at: at,
          result_ref: produced === null ? null : JSON.stringify(produced),
        })
        .where("id", "=", commandId)
        .where("outcome", "=", "async_pending")
        .execute();

      return true;
    });
  }

  /**
   * Name a command's audit event on its row.
   *
   * @param commandId - The command.
   * @param auditEventId - Its `chat.command_invoked` event.
   */
  async attachAudit(commandId: string, auditEventId: string): Promise<void> {
    await this.database.db
      .updateTable("chat_commands")
      .set({ audit_event_id: auditEventId })
      .where("id", "=", commandId)
      .execute();
  }
}
