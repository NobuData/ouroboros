/**
 * What the escalation timers and the button-press check read and write (BZ.4,
 * [#538](https://github.com/NobuData/ouroboros/issues/538)).
 *
 * The timer's rules are the database's (`V135`): `decision_escalation_timer_start` starts one per
 * item, `decision_escalation_fire` ends it by firing — stamping the item and its open cards in
 * the same statement group — and a trigger cancels it when the item stops waiting. This file
 * only calls those and writes the intents that follow a firing.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { ChatCardState, ChatMessageKind } from "../db/schema";
import type { EscalationTimerState } from "./chat.cards.decision";
import {
  DM_ROUTE_KIND,
  ON_CALL_SCOPE,
  chatDedupeKey,
  type ChatOutboxExecutor,
} from "./chat.outbox";

/** A timer that has come due, claimed by the pass that will fire it. */
export interface DueEscalationTimer {
  readonly id: string;
  readonly organizationId: string;
  readonly decisionItemId: string;
  readonly kindId: string;
}

/** A stored message, as a button press is checked against it. */
export interface PressedMessage {
  readonly id: string;
  readonly organizationId: string;
  readonly kind: ChatMessageKind;
  readonly decisionItemId: string | null;
  readonly state: ChatCardState | null;
}

/** What an escalation intended. */
export interface EscalationIntents {
  /** Posted open cards that will be re-rendered with the annotation. */
  readonly cardEdits: number;
  /** DMs to the on-call person — 0 when nobody is designated, or they have not linked. */
  readonly directMessages: number;
}

@Injectable()
export class ChatEscalationRepository {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Run some work in one transaction.
   *
   * @param work - The work.
   * @returns What it returned.
   */
  transaction<T>(work: (transaction: ChatOutboxExecutor) => Promise<T>): Promise<T> {
    return this.database.db.transaction().execute(work);
  }

  /**
   * Start a decision's escalation timer, once.
   *
   * @param executor - The transaction that intended the item's card.
   * @param itemId - The decision.
   * @returns When the item's pending timer is due, or undefined when none is pending.
   */
  async start(executor: ChatOutboxExecutor, itemId: string): Promise<Date | undefined> {
    const { rows } = await sql<{ due_at: Date | null }>`
      select ouroboros.decision_escalation_timer_start(${itemId}::uuid) as due_at`.execute(
      executor,
    );

    return rows[0]?.due_at ?? undefined;
  }

  /**
   * A decision's timer, as its card reads it.
   *
   * @param itemId - The decision.
   * @returns The timer's three instants, or undefined when the item has no timer.
   */
  async timer(itemId: string): Promise<EscalationTimerState | undefined> {
    const row = await this.database.db
      .selectFrom("decision_escalation_timers")
      .select(["due_at", "fired_at", "cancelled_at"])
      .where("decision_item_id", "=", itemId)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : { dueAt: row.due_at, firedAt: row.fired_at, cancelledAt: row.cancelled_at };
  }

  /**
   * Claim one pending timer that has come due, oldest first.
   *
   * The row is locked until the transaction ends, and a timer another pass holds is skipped
   * rather than waited for — so two processes never fire the same one.
   *
   * @param executor - The transaction that will fire it.
   * @param now - The instant timers are due by.
   * @returns The timer, or undefined when nothing is due.
   */
  async claimDue(executor: ChatOutboxExecutor, now: Date): Promise<DueEscalationTimer | undefined> {
    const { rows } = await sql<{
      id: string;
      organization_id: string;
      decision_item_id: string;
      kind_id: string;
    }>`
      select t.id, t.organization_id, t.decision_item_id, t.kind_id
        from ouroboros.decision_escalation_timers t
       where t.fired_at is null and t.cancelled_at is null
         and t.due_at <= ${now}
       order by t.due_at, t.id
       limit 1
         for update skip locked`.execute(executor);
    const [row] = rows;

    return row === undefined
      ? undefined
      : {
          id: row.id,
          organizationId: row.organization_id,
          decisionItemId: row.decision_item_id,
          kindId: row.kind_id,
        };
  }

  /**
   * Fire a claimed timer: stamp it, the item's `escalated_at` and its open cards' `escalated_at`.
   *
   * @param executor - The claiming transaction.
   * @param timerId - The timer.
   * @param now - The instant it fires at.
   * @returns False when the database refused — it was cancelled or fired in the meantime.
   */
  async fire(executor: ChatOutboxExecutor, timerId: string, now: Date): Promise<boolean> {
    const { rows } = await sql<{ fired: boolean }>`
      select ouroboros.decision_escalation_fire(${timerId}::uuid, ${now}::timestamptz) as fired`.execute(
      executor,
    );

    return rows[0]?.fired === true;
  }

  /**
   * Intend what an escalation says: an edit of each posted open card, and a DM of the card to
   * the on-call person.
   *
   * The DM goes to whoever is on call for decisions and has linked their chat identity, through
   * the workspace's active connection. When a route's *+ DM on-call* affix already sent them the
   * card at filing, that DM still holds the open card: the edit above annotates it, and this
   * post is absorbed by the one-open-card-per-conversation rule rather than sent twice. Each
   * intent is unique per item, so a pass that runs twice says it once.
   *
   * @param executor - The firing transaction.
   * @param timer - The timer that fired.
   * @returns How many of each were written.
   */
  async enqueue(
    executor: ChatOutboxExecutor,
    timer: DueEscalationTimer,
  ): Promise<EscalationIntents> {
    const cards = await sql<{
      organization_id: string;
      connection_id: string;
      channel_id: string;
      card_kind: string;
      route_kind: string;
      message_id: string;
    }>`
      select o.organization_id, o.connection_id, m.channel_id, o.card_kind, o.route_kind,
             m.id as message_id
        from ouroboros.chat_outbox o
        join ouroboros.chat_messages m on m.id = o.message_id
       where o.decision_item_id = ${timer.decisionItemId}::uuid
         and o.message_kind = 'decision_card'
         and o.operation = 'post'
         and m.platform_ts is not null
         and m.state = 'open'`.execute(executor);
    const edits =
      cards.rows.length === 0
        ? []
        : await executor
            .insertInto("chat_outbox")
            .values(
              cards.rows.map((card) => ({
                organization_id: card.organization_id,
                connection_id: card.connection_id,
                channel_id: card.channel_id,
                operation: "update" as const,
                message_kind: "decision_card" as const,
                card_kind: card.card_kind,
                decision_item_id: timer.decisionItemId,
                route_kind: card.route_kind,
                message_id: card.message_id,
                dedupe_key: chatDedupeKey([
                  "decision_card",
                  timer.decisionItemId,
                  "escalated",
                  card.message_id,
                ]),
              })),
            )
            .onConflict((conflict) => conflict.doNothing())
            .returning("id")
            .execute();

    const dms = await sql<{ id: string }>`
      insert into ouroboros.chat_outbox
        (organization_id, connection_id, dm_platform_user_id, message_kind, card_kind,
         decision_item_id, route_kind, dedupe_key)
      select ${timer.organizationId}, c.id, link.platform_user_id, 'decision_card',
             ${timer.kindId}, ${timer.decisionItemId}::uuid, ${DM_ROUTE_KIND},
             ${chatDedupeKey(["decision_card", timer.decisionItemId, "escalated_dm"])}
        from ouroboros.chat_connections c
        join ouroboros.on_call_assignments oncall
          on oncall.organization_id = c.organization_id
         and oncall.scope = ${ON_CALL_SCOPE}
         and oncall.active
        join ouroboros.chat_identity_links link
          on link.connection_id = c.id
         and link.member_id = oncall.member_id
         and link.state = 'linked'
       where c.organization_id = ${timer.organizationId}
         and c.platform = 'slack'
         and c.status = 'active'
      on conflict do nothing
      returning id`.execute(executor);

    return { cardEdits: edits.length, directMessages: dms.rows.length };
  }

  /**
   * The stored message a button was pressed on.
   *
   * @param connectionId - The connection the press arrived through.
   * @param platformChannelId - The platform's id of the channel (or DM) it was pressed in.
   * @param platformTs - The platform's timestamp of the message.
   * @returns The message, or undefined when this connection never posted one there.
   */
  async pressedMessage(
    connectionId: string,
    platformChannelId: string,
    platformTs: string,
  ): Promise<PressedMessage | undefined> {
    const row = await this.database.db
      .selectFrom("chat_messages as m")
      .innerJoin("chat_channels as ch", "ch.id", "m.channel_id")
      .select(["m.id", "m.organization_id", "m.kind", "m.decision_item_id", "m.state"])
      .where("ch.connection_id", "=", connectionId)
      .where("ch.channel_id", "=", platformChannelId)
      .where("m.platform_ts", "=", platformTs)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          id: row.id,
          organizationId: row.organization_id,
          kind: row.kind,
          decisionItemId: row.decision_item_id,
          state: row.state,
        };
  }

  /**
   * A person's display name — what a resolution and a transcript record them under.
   *
   * @param userId - `"user".id`.
   * @returns Their name, or undefined when the person no longer exists.
   */
  async personName(userId: string): Promise<string | undefined> {
    const row = await this.database.db
      .selectFrom("user")
      .select("name")
      .where("id", "=", userId)
      .executeTakeFirst();

    return row?.name;
  }

  /**
   * Record an edit that left a card open — its escalation annotation.
   *
   * @param messageId - The card.
   * @param at - When it was edited.
   */
  async recordEdited(messageId: string, at: Date): Promise<void> {
    await this.database.db
      .updateTable("chat_messages")
      .set({
        // An edit is never stamped before the post it edits (`chat_messages_edited_after_posted`).
        edited_at: sql<Date>`greatest(${at}::timestamptz, posted_at)`,
      })
      .where("id", "=", messageId)
      .where("kind", "=", "decision_card")
      .where("state", "=", "open")
      .execute();
  }
}
