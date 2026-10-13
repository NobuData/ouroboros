/**
 * The chat publisher's reads and writes (BZ.2,
 * [#536](https://github.com/NobuData/ouroboros/issues/536)).
 *
 * ```
 * chat_outbox     claimed for update skip locked · leased · settled        (V134)
 * chat_messages   a row before the post, its platform ts after              (V131)
 * chat_channels   a DM conversation is a channel too, tagged `dm`           (V130)
 * ```
 *
 * **A claim is a lease, not a lock.** {@link ChatRepository.claimDue} selects what is due,
 * skipping rows another replica holds, and pushes each one's `next_attempt_at` forward before
 * its transaction ends. The row is then free of any lock while the platform is called; a
 * dispatcher that dies mid-post leaves a row that simply becomes due again when the lease lapses.
 * That is at-least-once, on purpose — `chat_messages` is what stops it becoming twice.
 *
 * **The message row comes first.** A post inserts its `chat_messages` row, digest and all, before
 * the platform is called, and the outbox row remembers it. A retry reuses that row, so however
 * many attempts a post takes there is one record of it — and `chat_messages_dedupe_key` refuses a
 * second row for the same content in the same channel within the hour, whoever tries to write it.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import type {
  ChatCardState,
  ChatMessageKind,
  ChatOutboxOperation,
  ChatOutboxStatus,
  DecisionChannel,
  NotificationRouteConfig,
} from "../db/schema";
import { readSpendTotals } from "../runs/run.spend";
import type { LoopFinishedFacts } from "./chat.cards.events";
import { DM_PURPOSE_TAG, chatDedupeKey } from "./chat.outbox";

/** How long a settled row is kept: delivered ones briefly, dead letters long enough to be read. */
export const SETTLED_RETENTION_DAYS = 7;
export const DEAD_LETTER_RETENTION_DAYS = 30;

/** An outbox row a dispatcher holds the lease on. */
export interface ClaimedChatRow {
  readonly id: string;
  readonly organizationId: string;
  readonly connectionId: string;
  readonly channelId: string | null;
  readonly dmPlatformUserId: string | null;
  readonly operation: ChatOutboxOperation;
  readonly messageKind: Exclude<ChatMessageKind, "command_reply">;
  readonly cardKind: string;
  readonly decisionItemId: string | null;
  readonly subject: Readonly<Record<string, unknown>>;
  readonly routeKind: string;
  /** Attempts already made. */
  readonly attempts: number;
  readonly messageId: string | null;
}

/** A channel as the dispatcher needs it. */
export interface ChatChannelTarget {
  readonly id: string;
  /** The platform's id for it — what a post is addressed to. */
  readonly platformChannelId: string;
  readonly archived: boolean;
}

/** A stored message as the dispatcher needs it. */
export interface StoredChatMessage {
  readonly id: string;
  readonly channelId: string;
  readonly platformTs: string | null;
  readonly state: ChatCardState | null;
}

/** What a message row records about what was said. */
export interface ChatMessageWrite {
  readonly organizationId: string;
  readonly channelId: string;
  readonly kind: Exclude<ChatMessageKind, "command_reply">;
  readonly cardKind: string;
  readonly decisionItemId: string | null;
  readonly refs: readonly unknown[];
  readonly facts: Readonly<Record<string, unknown>>;
  readonly state: ChatCardState | null;
  readonly resolution: ChatMessageResolution | null;
  readonly payloadDigest: string;
  readonly at: Date;
}

/** A resolved card's outcome columns. */
export interface ChatMessageResolution {
  /** The action id the decision was answered with. */
  readonly outcome: string;
  readonly resolvedBy: string | null;
  readonly resolvedAt: Date;
}

/** How a decision ended, with who ended it. */
export interface ChatResolutionRow {
  readonly resolver: "human" | "policy";
  readonly policy: string | null;
  readonly actionId: string;
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly channel: DecisionChannel;
  readonly resolvedAt: Date;
}

/** A decision's card somewhere, posted or still on its way. */
export interface DecisionCardPlacement {
  readonly organizationId: string;
  readonly connectionId: string;
  readonly cardKind: string;
  readonly routeKind: string;
  /** The channel — known for a posted card and for a pending channel post. */
  readonly channelId: string | null;
  /** The person, for a DM that has not been dispatched yet. */
  readonly dmPlatformUserId: string | null;
  /** The posted, still-open card to edit; null when the post has not gone out. */
  readonly messageId: string | null;
}

/** A Slack route the weekly digest rides. */
export interface DigestRouteRow {
  readonly organizationId: string;
  readonly kind: string;
  readonly config: NotificationRouteConfig;
  /** The slot of the last digest enqueued for the workspace, or undefined. */
  readonly lastSlot: Date | undefined;
}

@Injectable()
export class ChatRepository {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Claim what is due, oldest first, and lease it.
   *
   * @param now - The instant rows are due by.
   * @param leaseUntil - What each claimed row's `next_attempt_at` becomes: when it is due again
   *   if this dispatcher never settles it.
   * @param limit - The most rows to claim.
   * @returns The claimed rows. Rows another dispatcher holds are skipped, not waited for.
   */
  async claimDue(now: Date, leaseUntil: Date, limit: number): Promise<ClaimedChatRow[]> {
    const { rows } = await sql<{
      id: string;
      organization_id: string;
      connection_id: string;
      channel_id: string | null;
      dm_platform_user_id: string | null;
      operation: ChatOutboxOperation;
      message_kind: ClaimedChatRow["messageKind"];
      card_kind: string;
      decision_item_id: string | null;
      subject: Record<string, unknown>;
      route_kind: string;
      attempts: number;
      message_id: string | null;
    }>`
      with due as (
        select o.id
          from ouroboros.chat_outbox o
         where o.status = 'pending' and o.next_attempt_at <= ${now}
         order by o.next_attempt_at, o.id
         limit ${limit}
           for update skip locked
      )
      update ouroboros.chat_outbox o
         set next_attempt_at = ${leaseUntil}
        from due
       where o.id = due.id
      returning o.id, o.organization_id, o.connection_id, o.channel_id, o.dm_platform_user_id,
                o.operation, o.message_kind, o.card_kind, o.decision_item_id, o.subject,
                o.route_kind, o.attempts, o.message_id, o.created_at`.execute(this.database.db);

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      connectionId: row.connection_id,
      channelId: row.channel_id,
      dmPlatformUserId: row.dm_platform_user_id,
      operation: row.operation,
      messageKind: row.message_kind,
      cardKind: row.card_kind,
      decisionItemId: row.decision_item_id,
      subject: row.subject,
      routeKind: row.route_kind,
      attempts: row.attempts,
      messageId: row.message_id,
    }));
  }

  /**
   * Whether a connection can still be published through.
   *
   * @param connectionId - The connection.
   * @returns True while it is `active`.
   */
  async connectionActive(connectionId: string): Promise<boolean> {
    const row = await this.database.db
      .selectFrom("chat_connections_public")
      .select("status")
      .where("id", "=", connectionId)
      .executeTakeFirst();

    return row?.status === "active";
  }

  /**
   * One channel.
   *
   * @param id - `chat_channels.id`.
   * @returns The channel, or undefined.
   */
  async channel(id: string): Promise<ChatChannelTarget | undefined> {
    const row = await this.database.db
      .selectFrom("chat_channels")
      .select(["id", "channel_id", "archived"])
      .where("id", "=", id)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : { id: row.id, platformChannelId: row.channel_id, archived: row.archived };
  }

  /**
   * The channel row of a DM conversation, created the first time the person is DMed.
   *
   * A DM is stored as a private, joined channel tagged {@link DM_PURPOSE_TAG}, so a message sent
   * to a person is recorded exactly as one sent to a channel is.
   *
   * @param row - The connection and workspace.
   * @param platformUserId - The person, whose id names the row.
   * @param platformChannelId - The conversation's id, from the platform.
   * @param at - When.
   * @returns The channel.
   */
  async ensureDmChannel(
    row: Pick<ClaimedChatRow, "organizationId" | "connectionId">,
    platformUserId: string,
    platformChannelId: string,
    at: Date,
  ): Promise<ChatChannelTarget> {
    const stored = await this.database.db
      .insertInto("chat_channels")
      .values({
        organization_id: row.organizationId,
        connection_id: row.connectionId,
        platform: "slack",
        channel_id: platformChannelId,
        channel_name: platformUserId,
        is_private: true,
        joined: true,
        joined_at: at,
        purpose_tag: DM_PURPOSE_TAG,
      })
      .onConflict((conflict) =>
        conflict
          .columns(["connection_id", "channel_id"])
          // A no-op write, so the row comes back whether it was just made or already there.
          .doUpdateSet({ purpose_tag: DM_PURPOSE_TAG }),
      )
      .returning(["id", "channel_id", "archived"])
      .executeTakeFirstOrThrow();

    return { id: stored.id, platformChannelId: stored.channel_id, archived: stored.archived };
  }

  /**
   * Record that a channel takes no posts from the bot any more.
   *
   * @param id - The channel.
   * @param error - The platform's error: `is_archived` archives it; anything else means the bot
   *   is no longer a member.
   */
  async markChannelGone(id: string, error: string): Promise<void> {
    await this.database.db
      .updateTable("chat_channels")
      .set(error === "is_archived" ? { archived: true } : { joined: false })
      .where("id", "=", id)
      .execute();
  }

  /**
   * One stored message.
   *
   * @param id - `chat_messages.id`.
   * @returns The message, or undefined.
   */
  async message(id: string): Promise<StoredChatMessage | undefined> {
    const row = await this.database.db
      .selectFrom("chat_messages")
      .select(["id", "channel_id", "platform_ts", "state"])
      .where("id", "=", id)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          id: row.id,
          channelId: row.channel_id,
          platformTs: row.platform_ts,
          state: row.state,
        };
  }

  /**
   * Record a message that is about to be posted.
   *
   * @param write - What it says and where.
   * @returns The new row's id; or the row that already says it — same content in the same
   *   channel within the hour, or an open card for the same decision in the same channel — and
   *   whether that one reached the platform.
   */
  async insertMessage(
    write: ChatMessageWrite,
  ): Promise<
    { created: true; id: string } | { created: false; existing: StoredChatMessage | undefined }
  > {
    const inserted = await this.database.db
      .insertInto("chat_messages")
      .values({
        organization_id: write.organizationId,
        channel_id: write.channelId,
        kind: write.kind,
        card_kind: write.cardKind,
        decision_item_id: write.decisionItemId,
        refs: JSON.stringify(write.refs),
        facts: JSON.stringify(write.facts),
        state: write.state,
        outcome: write.resolution?.outcome ?? null,
        resolved_by: write.resolution?.resolvedBy ?? null,
        resolved_at: write.resolution?.resolvedAt ?? null,
        payload_digest: write.payloadDigest,
        posted_at: write.at,
      })
      .onConflict((conflict) => conflict.doNothing())
      .returning("id")
      .executeTakeFirst();

    if (inserted !== undefined) {
      return { created: true, id: inserted.id };
    }

    const existing = await this.database.db
      .selectFrom("chat_messages")
      .select(["id", "channel_id", "platform_ts", "state"])
      .where("channel_id", "=", write.channelId)
      .where((eb) =>
        eb.or([
          eb("payload_digest", "=", write.payloadDigest),
          ...(write.kind === "decision_card" && write.decisionItemId !== null
            ? [
                eb.and([
                  eb("kind", "=", "decision_card"),
                  eb("state", "=", "open"),
                  eb("decision_item_id", "=", write.decisionItemId),
                ]),
              ]
            : []),
        ]),
      )
      .orderBy("posted_at", "desc")
      .limit(1)
      .executeTakeFirst();

    return {
      created: false,
      existing:
        existing === undefined
          ? undefined
          : {
              id: existing.id,
              channelId: existing.channel_id,
              platformTs: existing.platform_ts,
              state: existing.state,
            },
    };
  }

  /**
   * Record the platform's answer to a post.
   *
   * @param messageId - The message.
   * @param ts - The platform's timestamp for it.
   */
  async stampPosted(messageId: string, ts: string): Promise<void> {
    await this.database.db
      .updateTable("chat_messages")
      .set({ platform_ts: ts })
      .where("id", "=", messageId)
      .where("platform_ts", "is", null)
      .execute();
  }

  /**
   * Record an edit that closed a card.
   *
   * @param messageId - The card.
   * @param resolution - How the decision ended.
   * @param payloadDigest - The digest of what the card now says.
   * @param at - When it was edited.
   */
  async recordResolved(
    messageId: string,
    resolution: ChatMessageResolution,
    payloadDigest: string,
    at: Date,
  ): Promise<void> {
    await this.database.db
      .updateTable("chat_messages")
      .set({
        state: "resolved",
        outcome: resolution.outcome,
        resolved_by: resolution.resolvedBy,
        resolved_at: resolution.resolvedAt,
        payload_digest: payloadDigest,
        // An edit is never stamped before the post it edits (`chat_messages_edited_after_posted`).
        edited_at: sql<Date>`greatest(${at}::timestamptz, posted_at)`,
      })
      .where("id", "=", messageId)
      .where("kind", "=", "decision_card")
      .execute();
  }

  /**
   * Settle a row: it will not be tried again.
   *
   * @param id - The row.
   * @param status - How it ended.
   * @param detail.error - Why, for a skip or a dead letter.
   * @param detail.messageId - The message it posted, edited or was absorbed by.
   * @param detail.attempts - The attempts made, when this settlement counted one.
   * @param at - When.
   * @returns False when the row was already settled — by another dispatcher past a lapsed lease.
   */
  async settle(
    id: string,
    status: Exclude<ChatOutboxStatus, "pending">,
    detail: { error?: string; messageId?: string | null; attempts?: number },
    at: Date,
  ): Promise<boolean> {
    const result = await this.database.db
      .updateTable("chat_outbox")
      .set({
        status,
        next_attempt_at: null,
        settled_at: at,
        last_error:
          detail.error === undefined ? sql<string | null>`last_error` : clipError(detail.error),
        ...(detail.messageId === undefined || detail.messageId === null
          ? {}
          : { message_id: detail.messageId }),
        ...(detail.attempts === undefined ? {} : { attempts: detail.attempts }),
      })
      .where("id", "=", id)
      .where("status", "=", "pending")
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  /**
   * Schedule another attempt.
   *
   * @param id - The row.
   * @param retry.attempts - The attempts made so far.
   * @param retry.nextAttemptAt - When it is due again.
   * @param retry.error - What went wrong.
   * @param retry.messageId - The message row the attempt wrote, to be reused by the next.
   */
  async retry(
    id: string,
    retry: { attempts: number; nextAttemptAt: Date; error: string; messageId?: string | null },
  ): Promise<void> {
    await this.database.db
      .updateTable("chat_outbox")
      .set({
        attempts: retry.attempts,
        next_attempt_at: retry.nextAttemptAt,
        last_error: clipError(retry.error),
        ...(retry.messageId === undefined || retry.messageId === null
          ? {}
          : { message_id: retry.messageId }),
      })
      .where("id", "=", id)
      .where("status", "=", "pending")
      .execute();
  }

  /**
   * Put claimed rows back, due at a later instant, without counting an attempt — for rows that
   * were never tried because their connection was told to wait.
   *
   * @param ids - The rows.
   * @param nextAttemptAt - When they are due again.
   */
  async defer(ids: readonly string[], nextAttemptAt: Date): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.database.db
      .updateTable("chat_outbox")
      .set({ next_attempt_at: nextAttemptAt })
      .where("id", "in", [...ids])
      .where("status", "=", "pending")
      .execute();
  }

  /**
   * Remove settled rows that have served their purpose.
   *
   * @param now - The instant retention is measured from.
   * @returns How many rows went.
   */
  async prune(now: Date): Promise<number> {
    const settledBefore = new Date(now.getTime() - SETTLED_RETENTION_DAYS * 86_400_000);
    const deadBefore = new Date(now.getTime() - DEAD_LETTER_RETENTION_DAYS * 86_400_000);
    const result = await this.database.db
      .deleteFrom("chat_outbox")
      .where((eb) =>
        eb.or([
          eb.and([
            eb("status", "in", ["sent", "absorbed", "skipped"]),
            eb("settled_at", "<", settledBefore),
          ]),
          eb.and([eb("status", "=", "dead_lettered"), eb("settled_at", "<", deadBefore)]),
        ]),
      )
      .executeTakeFirst();

    return Number(result.numDeletedRows);
  }

  /**
   * How a decision ended.
   *
   * @param itemId - The decision.
   * @returns Who, how and when — or undefined while it is unanswered.
   */
  async resolution(itemId: string): Promise<ChatResolutionRow | undefined> {
    const { rows } = await sql<{
      resolver: "human" | "policy";
      resolved_by_policy: string | null;
      resolved_by_user: string | null;
      action_id: string;
      person_name: string | null;
      channel: DecisionChannel;
      resolved_at: Date;
    }>`
      select r.resolver, r.resolved_by_policy, r.resolved_by_user, r.action_id,
             u."name" as person_name, r.channel, r.resolved_at
        from ouroboros.decision_resolutions r
        left join ouroboros."user" u on u."id" = r.resolved_by_user
       where r.item_id = ${itemId}::uuid`.execute(this.database.db);
    const [row] = rows;

    return row === undefined
      ? undefined
      : {
          resolver: row.resolver,
          policy: row.resolved_by_policy,
          actionId: row.action_id,
          actorId: row.resolved_by_user,
          actorName: row.person_name,
          channel: row.channel,
          resolvedAt: row.resolved_at,
        };
  }

  /**
   * What a finished loop's card prints.
   *
   * @param organizationId - The workspace.
   * @param runId - The run.
   * @returns The facts, or undefined when the run is gone.
   */
  async loopFinishedFacts(
    organizationId: string,
    runId: string,
  ): Promise<LoopFinishedFacts | undefined> {
    const db = this.database.db;
    const run = await db
      .selectFrom("runs")
      .select([
        "id",
        "loop_seq",
        "issue_number",
        "issue_title",
        "pr_number",
        "checks_passed",
        "checks_total",
        "started_at",
        "finished_at",
        "model",
      ])
      .where("organization_id", "=", organizationId)
      .where("id", "=", runId)
      .executeTakeFirst();

    if (run === undefined) {
      return undefined;
    }

    const [pr, spend] = await Promise.all([
      run.pr_number === null
        ? undefined
        : db
            .selectFrom("pull_requests")
            .select("id")
            .where("organization_id", "=", organizationId)
            .where("run_id", "=", runId)
            .where("external_number", "=", run.pr_number)
            .executeTakeFirst(),
      readSpendTotals(db, runId),
    ]);

    return {
      runId: run.id,
      loopSeq: run.loop_seq,
      issueNumber: run.issue_number,
      issueTitle: run.issue_title,
      prNumber: run.pr_number,
      prId: pr?.id ?? null,
      checksPassed: run.checks_passed,
      checksTotal: run.checks_total,
      cycleSeconds:
        run.started_at === null || run.finished_at === null
          ? null
          : Math.max(0, (run.finished_at.getTime() - run.started_at.getTime()) / 1000),
      costCents: spend.costCents,
      unpricedEvents: spend.unpricedEvents,
      model: run.model,
    };
  }

  /**
   * Everywhere a decision's card is, or is about to be.
   *
   * @param itemId - The decision.
   * @returns One placement per posted open card, and one per post still waiting in the outbox.
   */
  async cardPlacements(itemId: string): Promise<DecisionCardPlacement[]> {
    const { rows } = await sql<{
      organization_id: string;
      connection_id: string;
      card_kind: string;
      route_kind: string;
      channel_id: string | null;
      dm_platform_user_id: string | null;
      message_id: string | null;
    }>`
      select o.organization_id, o.connection_id, o.card_kind, o.route_kind,
             coalesce(m.channel_id, o.channel_id) as channel_id,
             case when m.id is null then o.dm_platform_user_id end as dm_platform_user_id,
             case when m.platform_ts is not null and m.state = 'open' then m.id end as message_id
        from ouroboros.chat_outbox o
        left join ouroboros.chat_messages m on m.id = o.message_id
       where o.decision_item_id = ${itemId}::uuid
         and o.message_kind = 'decision_card'
         and o.operation = 'post'
         and o.status in ('pending', 'sent', 'absorbed')`.execute(this.database.db);

    return rows.map((row) => ({
      organizationId: row.organization_id,
      connectionId: row.connection_id,
      cardKind: row.card_kind,
      routeKind: row.route_kind,
      channelId: row.channel_id,
      dmPlatformUserId: row.dm_platform_user_id,
      messageId: row.message_id,
    }));
  }

  /**
   * Intend what follows a resolution: an edit of each posted card, and a system line beside it.
   *
   * @param itemId - The decision.
   * @param actionId - What it was answered with — part of what makes the intent unique.
   * @param placements - Where its card is.
   * @param lineDueAt - When the system lines are due: just after the edits, so a channel reads
   *   the card closing and then the line.
   * @returns How many rows were written.
   */
  async enqueueResolution(
    itemId: string,
    actionId: string,
    placements: readonly DecisionCardPlacement[],
    lineDueAt: Date,
  ): Promise<number> {
    const rows = placements.flatMap((placement) => {
      const base = {
        organization_id: placement.organizationId,
        connection_id: placement.connectionId,
        channel_id: placement.channelId,
        dm_platform_user_id: placement.channelId === null ? placement.dmPlatformUserId : null,
        card_kind: placement.cardKind,
        decision_item_id: itemId,
        route_kind: placement.routeKind,
      };

      return [
        ...(placement.messageId === null
          ? []
          : [
              {
                ...base,
                operation: "update" as const,
                message_kind: "decision_card" as const,
                message_id: placement.messageId,
                dedupe_key: chatDedupeKey([
                  "decision_card",
                  itemId,
                  "resolved",
                  placement.messageId,
                ]),
                next_attempt_at: undefined,
              },
            ]),
        {
          ...base,
          operation: "post" as const,
          message_kind: "system_line" as const,
          message_id: null,
          dedupe_key: chatDedupeKey(["system_line", itemId, actionId]),
          next_attempt_at: lineDueAt,
        },
      ];
    });

    if (rows.length === 0) {
      return 0;
    }

    const written = await this.database.db
      .insertInto("chat_outbox")
      .values(rows)
      .onConflict((conflict) => conflict.doNothing())
      .returning("id")
      .execute();

    return written.length;
  }

  /**
   * Every enabled Slack route the weekly digest rides, in a workspace with an active connection.
   *
   * @param kinds - The route kinds a digest rides.
   * @returns One row per route, with the slot of the last digest its workspace was sent.
   */
  async digestRoutes(kinds: readonly string[]): Promise<DigestRouteRow[]> {
    const { rows } = await sql<{
      organization_id: string;
      kind: string;
      config: NotificationRouteConfig;
      last_slot: string | null;
    }>`
      select r.organization_id, r.kind, r.config,
             (select max(o.subject ->> 'slot')
                from ouroboros.chat_outbox o
               where o.organization_id = r.organization_id
                 and o.message_kind = 'event_card' and o.card_kind = 'digest') as last_slot
        from ouroboros.notification_routes_effective e
        join ouroboros.notification_routes r
          on r.organization_id = e.organization_id and r.kind = e.kind
       where e.delivering and e.channel = 'slack'
         and r.kind in (${sql.join(kinds.map((kind) => sql`${kind}`))})
       order by r.organization_id, r.kind`.execute(this.database.db);

    return rows.map((row) => ({
      organizationId: row.organization_id,
      kind: row.kind,
      config: row.config,
      lastSlot: row.last_slot === null ? undefined : new Date(row.last_slot),
    }));
  }
}

/**
 * An error as `chat_outbox.last_error` stores it.
 *
 * @param error - The error.
 * @returns It, trimmed and clipped to the column's 500 characters; a blank one says so.
 */
export function clipError(error: string): string {
  const trimmed = error.trim().slice(0, 500).trim();

  return trimmed === "" ? "unknown error" : trimmed;
}
