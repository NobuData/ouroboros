/**
 * The channel mirror's reads (CA.2, [#542](https://github.com/NobuData/ouroboros/issues/542)) —
 * a channel's stream as **our** records hold it: `chat_messages` and `chat_commands`.
 *
 * ```
 * messages      the channel's cards and lines, newest first   (never `command_reply` rows —
 *               a command's reply is on the command)
 * commands      the commands typed in the channel, newest first, with who typed each
 * runs          loop numbers for the runs event cards name
 * pullRequests  the pull requests event cards name, by id or by run
 * people        names of the people who answered
 * ```
 *
 * **One order for two tables.** A page is `instant desc, id desc` over both — `posted_at` for a
 * message, `invoked_at` for a command — and a cursor is that pair, so the same cursor bounds
 * both queries and the service merges two already-sorted lists. The instant travels as
 * PostgreSQL's microsecond text, as the audit plane's cursor does: a JavaScript `Date` would
 * round to the millisecond and skip or repeat rows inside it.
 *
 * Every read names the workspace: a channel id alone never selects a row.
 */

import { Injectable } from "@nestjs/common";
import { sql, type SqlBool } from "kysely";

import type { AuditCursor } from "../audit-plane/audit-plane.cursor";
import { DatabaseService } from "../db/db.service";
import type { ChatCommand, ChatMessage } from "../db/schema";

/** A position in a mirror's order: an instant as UTC microsecond text, and a row id. */
export type MirrorCursor = AuditCursor;

/** A message of the stream, with its place in the order. */
export type MirrorMessageRow = Pick<
  ChatMessage,
  | "id"
  | "kind"
  | "card_kind"
  | "decision_item_id"
  | "refs"
  | "facts"
  | "state"
  | "outcome"
  | "resolved_by"
  | "resolved_at"
  | "escalated_at"
  | "posted_at"
> & {
  /** `posted_at` as UTC text with microseconds. */
  readonly cursor_at: string;
};

/** A command of the stream, with who typed it and its place in the order. */
export type MirrorCommandRow = Pick<
  ChatCommand,
  | "id"
  | "surface"
  | "raw_text"
  | "outcome"
  | "result_ref"
  | "reply"
  | "settled_reply"
  | "invoked_at"
  | "completed_at"
> & {
  /** The person it acted as; null for an unlinked attempt or a person since deleted. */
  readonly author_name: string | null;
  /** `invoked_at` as UTC text with microseconds. */
  readonly cursor_at: string;
};

/** A run an event card names. */
export interface MirrorRun {
  readonly id: string;
  readonly loopSeq: number;
}

/** A pull request an event card names. */
export interface MirrorPullRequest {
  readonly id: string;
  readonly runId: string | null;
  readonly number: number;
}

/** `posted_at` as the cursor carries it. */
const POSTED_AT = sql<string>`to_char(chat_messages.posted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** `invoked_at` as the cursor carries it. */
const INVOKED_AT = sql<string>`to_char(chat_commands.invoked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

@Injectable()
export class ChatMirrorRepository {
  /** @param database - The typed connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The channel's cards and lines, newest first.
   *
   * @param organizationId - The workspace.
   * @param channelId - The channel row.
   * @param before - Only rows strictly older than this position; `undefined` for the newest.
   * @param limit - How many rows at most.
   * @returns The rows. `command_reply` rows are left out: they mark that a reply was given and
   *   hold none of its words, which are on the command.
   */
  async messages(
    organizationId: string,
    channelId: string,
    before: MirrorCursor | undefined,
    limit: number,
  ): Promise<MirrorMessageRow[]> {
    let query = this.database.db
      .selectFrom("chat_messages")
      .select([
        "chat_messages.id",
        "chat_messages.kind",
        "chat_messages.card_kind",
        "chat_messages.decision_item_id",
        "chat_messages.refs",
        "chat_messages.facts",
        "chat_messages.state",
        "chat_messages.outcome",
        "chat_messages.resolved_by",
        "chat_messages.resolved_at",
        "chat_messages.escalated_at",
        "chat_messages.posted_at",
        POSTED_AT.as("cursor_at"),
      ])
      .where("chat_messages.organization_id", "=", organizationId)
      .where("chat_messages.channel_id", "=", channelId)
      .where("chat_messages.kind", "<>", "command_reply");

    if (before !== undefined) {
      query = query.where(
        sql<SqlBool>`(chat_messages.posted_at, chat_messages.id) < (${before.at}::timestamptz, ${before.id}::uuid)`,
      );
    }

    return query
      .orderBy("chat_messages.posted_at", "desc")
      .orderBy("chat_messages.id", "desc")
      .limit(limit)
      .execute();
  }

  /**
   * The commands typed in the channel — in Slack, or under its mirror in the console — newest
   * first.
   *
   * @param organizationId - The workspace.
   * @param channelId - The channel row.
   * @param before - Only rows strictly older than this position; `undefined` for the newest.
   * @param limit - How many rows at most.
   * @returns The rows, each with the name of the person it acted as.
   */
  async commands(
    organizationId: string,
    channelId: string,
    before: MirrorCursor | undefined,
    limit: number,
  ): Promise<MirrorCommandRow[]> {
    let query = this.database.db
      .selectFrom("chat_commands")
      .leftJoin("user", "user.id", "chat_commands.invoker_user_id")
      .select([
        "chat_commands.id",
        "chat_commands.surface",
        "chat_commands.raw_text",
        "chat_commands.outcome",
        "chat_commands.result_ref",
        "chat_commands.reply",
        "chat_commands.settled_reply",
        "chat_commands.invoked_at",
        "chat_commands.completed_at",
        "user.name as author_name",
        INVOKED_AT.as("cursor_at"),
      ])
      .where("chat_commands.organization_id", "=", organizationId)
      .where("chat_commands.channel_id", "=", channelId);

    if (before !== undefined) {
      query = query.where(
        sql<SqlBool>`(chat_commands.invoked_at, chat_commands.id) < (${before.at}::timestamptz, ${before.id}::uuid)`,
      );
    }

    return query
      .orderBy("chat_commands.invoked_at", "desc")
      .orderBy("chat_commands.id", "desc")
      .limit(limit)
      .execute();
  }

  /**
   * The loop numbers of some runs.
   *
   * @param organizationId - The workspace.
   * @param ids - Run ids — UUIDs; the caller has checked their shape.
   * @returns One row per run that still exists here.
   */
  async runs(organizationId: string, ids: readonly string[]): Promise<MirrorRun[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.database.db
      .selectFrom("runs")
      .select(["id", "loop_seq"])
      .where("organization_id", "=", organizationId)
      .where("id", "in", ids)
      .execute();

    return rows.map((row) => ({ id: row.id, loopSeq: row.loop_seq }));
  }

  /**
   * The pull requests some cards name — by their own id, or as the pull request of a run.
   *
   * @param organizationId - The workspace.
   * @param ids - Pull request ids — UUIDs; the caller has checked their shape.
   * @param runIds - Run ids — UUIDs; the caller has checked their shape.
   * @returns One row per pull request with one of the ids, or opened by one of the runs.
   */
  async pullRequests(
    organizationId: string,
    ids: readonly string[],
    runIds: readonly string[],
  ): Promise<MirrorPullRequest[]> {
    if (ids.length === 0 && runIds.length === 0) {
      return [];
    }

    const rows = await this.database.db
      .selectFrom("pull_requests")
      .select(["id", "run_id", "external_number"])
      .where("organization_id", "=", organizationId)
      .where((eb) =>
        eb.or([
          ...(ids.length === 0 ? [] : [eb("id", "in", ids)]),
          ...(runIds.length === 0 ? [] : [eb("run_id", "in", runIds)]),
        ]),
      )
      .execute();

    return rows.map((row) => ({ id: row.id, runId: row.run_id, number: row.external_number }));
  }

  /**
   * The names of some people.
   *
   * @param userIds - `"user".id`s.
   * @returns Name by id, for each person who still exists.
   */
  async people(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const rows = await this.database.db
      .selectFrom("user")
      .select(["id", "name"])
      .where("id", "in", userIds)
      .execute();

    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
