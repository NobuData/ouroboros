/**
 * The statements behind the Needs-You page's reads and snooze (BN.4,
 * [#464](https://github.com/NobuData/ouroboros/issues/464)).
 *
 * ```
 * queue      wake elapsed snoozes · open items (an elapsed snooze counts as open) · snoozed items
 * resolved   one UTC day's resolutions, newest first, with the person who answered · the day before
 * metrics    this UTC week's decision_metrics_weekly row and its per-kind medians (V095/V097)
 * snooze     decision_item_snooze · decision_items_snooze_all · un-snooze (one, or all)
 * ```
 *
 * Every statement takes the workspace, so an item of another workspace is simply not there. The
 * metric views are not mirrored in `db/schema.ts` (they are read-only aggregates), so they are read
 * with SQL and their intervals arrive as seconds.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { DecisionChannel, DecisionItemStatus, DecisionSeverity } from "../db/schema";

/** One item as the queue reads it. */
export interface InboxItemRow {
  readonly id: string;
  readonly kindId: string;
  readonly kindVersion: number;
  readonly severity: DecisionSeverity;
  readonly status: DecisionItemStatus;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly refs: unknown;
  /** Where the item came from — `planning:batch:<uuid>`; a link action may lead there (#467). */
  readonly sourceRef: string;
  readonly createdAt: Date;
  readonly snoozedUntil: Date | null;
  readonly snoozedBy: string | null;
  readonly snoozeReason: string | null;
}

/** One resolution of a day, with its item. */
export interface InboxResolvedRow {
  readonly itemId: string;
  readonly kindId: string;
  readonly kindVersion: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly refs: unknown;
  readonly actionId: string;
  readonly resolver: "human" | "policy";
  readonly policy: string | null;
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly channel: DecisionChannel;
  readonly note: string | null;
  readonly outcome: Record<string, unknown>;
  readonly resolvedAt: Date;
  readonly answerLatencySeconds: number;
  readonly loopWaitSeconds: number | null;
}

/** A week's figures — every duration in seconds; null where the view has none. */
export interface InboxWeekRow {
  readonly week: string;
  readonly decisions: number;
  readonly medianAnswerSeconds: number | null;
  readonly maxLoopWaitSeconds: number | null;
  readonly policyResolutions: number;
  readonly autoAcceptShare: number | null;
  /** Each kind's median answer time this week, in seconds. */
  readonly perKind: Readonly<Record<string, number>>;
}

/** The columns the queue reads. */
const ITEM_COLUMNS = [
  "id",
  "kind_id",
  "kind_version",
  "severity",
  "status",
  "payload",
  "refs",
  "source_ref",
  "created_at",
  "snoozed_until",
  "snoozed_by",
  "snooze_reason",
] as const;

/**
 * A row as {@link InboxItemRow}.
 *
 * @param row - The selected columns.
 * @returns The item.
 */
function itemOf(row: {
  id: string;
  kind_id: string;
  kind_version: number;
  severity: DecisionSeverity;
  status: DecisionItemStatus;
  payload: Record<string, unknown>;
  refs: unknown;
  source_ref: string;
  created_at: Date;
  snoozed_until: Date | null;
  snoozed_by: string | null;
  snooze_reason: string | null;
}): InboxItemRow {
  return {
    id: row.id,
    kindId: row.kind_id,
    kindVersion: row.kind_version,
    severity: row.severity,
    status: row.status,
    payload: row.payload,
    refs: row.refs,
    sourceRef: row.source_ref,
    createdAt: row.created_at,
    snoozedUntil: row.snoozed_until,
    snoozedBy: row.snoozed_by,
    snoozeReason: row.snooze_reason,
  };
}

@Injectable()
export class InboxRepository {
  /**
   * @param database - The pool owner.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Re-open the workspace's items whose snooze has elapsed (`decision_items_wake`, V095) — run
   * before the queue is read, so a woken item is open in the row and not only in the arithmetic.
   *
   * @param organizationId - The workspace.
   * @returns How many woke.
   */
  async wake(organizationId: string): Promise<number> {
    const result = await sql<{ woken: number }>`
      select ouroboros.decision_items_wake(${organizationId}) as woken
    `.execute(this.database.db);

    return Number(result.rows[0]?.woken ?? 0);
  }

  /**
   * The asking items — open, or snoozed with the snooze already elapsed — newest first.
   *
   * @param organizationId - The workspace.
   * @param now - The instant the snoozes are judged at.
   * @returns The items.
   */
  async open(organizationId: string, now: Date): Promise<InboxItemRow[]> {
    const rows = await this.database.db
      .selectFrom("decision_items")
      .select(ITEM_COLUMNS)
      .where("organization_id", "=", organizationId)
      .where((w) =>
        w.or([
          w("status", "=", "open"),
          w.and([w("status", "=", "snoozed"), w("snoozed_until", "<=", now)]),
        ]),
      )
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .execute();

    return rows.map(itemOf);
  }

  /**
   * The items still hidden by a snooze, soonest to wake first.
   *
   * @param organizationId - The workspace.
   * @param now - The instant the snoozes are judged at.
   * @returns The items.
   */
  async snoozed(organizationId: string, now: Date): Promise<InboxItemRow[]> {
    const rows = await this.database.db
      .selectFrom("decision_items")
      .select(ITEM_COLUMNS)
      .where("organization_id", "=", organizationId)
      .where("status", "=", "snoozed")
      .where("snoozed_until", ">", now)
      .orderBy("snoozed_until")
      .orderBy("id")
      .execute();

    return rows.map(itemOf);
  }

  /**
   * One item of the workspace.
   *
   * @param organizationId - The workspace.
   * @param itemId - The item.
   * @returns The item, or `undefined`.
   */
  async item(organizationId: string, itemId: string): Promise<InboxItemRow | undefined> {
    const row = await this.database.db
      .selectFrom("decision_items")
      .select(ITEM_COLUMNS)
      .where("organization_id", "=", organizationId)
      .where("id", "=", itemId)
      .executeTakeFirst();

    return row === undefined ? undefined : itemOf(row);
  }

  /**
   * One UTC day's resolutions, newest first.
   *
   * @param organizationId - The workspace.
   * @param day - `YYYY-MM-DD`, a UTC day.
   * @returns The rows.
   */
  async resolved(organizationId: string, day: string): Promise<InboxResolvedRow[]> {
    const result = await sql<{
      item_id: string;
      kind_id: string;
      kind_version: number;
      payload: Record<string, unknown>;
      refs: unknown;
      action_id: string;
      resolver: "human" | "policy";
      resolved_by_policy: string | null;
      resolved_by_user: string | null;
      person_name: string | null;
      channel: DecisionChannel;
      note: string | null;
      outcome: Record<string, unknown>;
      resolved_at: Date;
      answer_seconds: string;
      wait_seconds: string | null;
    }>`
      select r.item_id, i.kind_id, i.kind_version, i.payload, i.refs, r.action_id, r.resolver,
             r.resolved_by_policy, r.resolved_by_user, u.name as person_name, r.channel, r.note,
             r.outcome, r.resolved_at,
             extract(epoch from r.answer_latency)::text as answer_seconds,
             extract(epoch from r.loop_wait)::text as wait_seconds
        from ouroboros.decision_resolutions r
        join ouroboros.decision_items i on i.id = r.item_id
        left join ouroboros."user" u on u.id = r.resolved_by_user
       where r.organization_id = ${organizationId}
         and r.resolved_at >= (${day}::date)::timestamp at time zone 'UTC'
         and r.resolved_at < ((${day}::date) + 1)::timestamp at time zone 'UTC'
       order by r.resolved_at desc, r.item_id desc
    `.execute(this.database.db);

    return result.rows.map((row) => ({
      itemId: row.item_id,
      kindId: row.kind_id,
      kindVersion: row.kind_version,
      payload: row.payload,
      refs: row.refs,
      actionId: row.action_id,
      resolver: row.resolver,
      policy: row.resolved_by_policy,
      actorId: row.resolved_by_user,
      actorName: row.person_name,
      channel: row.channel,
      note: row.note,
      outcome: row.outcome,
      resolvedAt: row.resolved_at,
      answerLatencySeconds: Number(row.answer_seconds),
      loopWaitSeconds: row.wait_seconds === null ? null : Number(row.wait_seconds),
    }));
  }

  /**
   * The latest UTC day before `day` with any resolution — the history's previous page.
   *
   * @param organizationId - The workspace.
   * @param day - `YYYY-MM-DD`.
   * @returns The day, or null when there is no earlier history.
   */
  async previousDay(organizationId: string, day: string): Promise<string | null> {
    const result = await sql<{ day: string | null }>`
      select to_char(max(r.resolved_at at time zone 'UTC'), 'YYYY-MM-DD') as day
        from ouroboros.decision_resolutions r
       where r.organization_id = ${organizationId}
         and r.resolved_at < (${day}::date)::timestamp at time zone 'UTC'
    `.execute(this.database.db);

    return result.rows[0]?.day ?? null;
  }

  /**
   * The UTC week's figures (V095's `decision_metrics_weekly`, closures left out by V097).
   *
   * @param organizationId - The workspace.
   * @param week - The week's Monday, `YYYY-MM-DD`.
   * @returns The row, or `undefined` when nothing was answered that week.
   */
  async week(organizationId: string, week: string): Promise<InboxWeekRow | undefined> {
    const result = await sql<{
      week: string;
      decisions: number;
      median_seconds: string | null;
      max_wait_seconds: string | null;
      policy_resolutions: number;
      auto_accept_share: string | null;
      per_kind: Record<string, number> | null;
    }>`
      select to_char(w.week, 'YYYY-MM-DD') as week, w.decisions,
             extract(epoch from w.median_answer_latency)::text as median_seconds,
             extract(epoch from w.max_loop_wait)::text as max_wait_seconds,
             w.policy_resolutions, w.auto_accept_share::text as auto_accept_share,
             w.per_kind_median_answer_seconds as per_kind
        from ouroboros.decision_metrics_weekly w
       where w.organization_id = ${organizationId} and w.week = ${week}::date
    `.execute(this.database.db);
    const row = result.rows[0];

    return row === undefined
      ? undefined
      : {
          week: row.week,
          decisions: Number(row.decisions),
          medianAnswerSeconds: row.median_seconds === null ? null : Number(row.median_seconds),
          maxLoopWaitSeconds: row.max_wait_seconds === null ? null : Number(row.max_wait_seconds),
          policyResolutions: Number(row.policy_resolutions),
          autoAcceptShare: row.auto_accept_share === null ? null : Number(row.auto_accept_share),
          perKind: Object.fromEntries(
            Object.entries(row.per_kind ?? {}).map(([kind, seconds]) => [kind, Number(seconds)]),
          ),
        };
  }

  /**
   * Snooze one open (or re-snooze one snoozed) item — `decision_item_snooze`, which records the
   * scope-item event.
   *
   * @param itemId - The item, already checked to be the workspace's.
   * @param until - When it re-surfaces.
   * @param actorId - Who snoozed it, or null for a caller with no person.
   * @param reason - Why, optional.
   * @returns The snooze event's id.
   */
  async snooze(
    itemId: string,
    until: Date,
    actorId: string | null,
    reason: string | null,
  ): Promise<string> {
    const result = await sql<{ event_id: string }>`
      select ouroboros.decision_item_snooze(${itemId}::uuid, ${until}, ${actorId}, ${reason}) as event_id
    `.execute(this.database.db);

    return result.rows[0].event_id;
  }

  /**
   * Snooze every open item of the workspace as one scope-all event — `decision_items_snooze_all`.
   *
   * @param organizationId - The workspace.
   * @param until - When they re-surface.
   * @param actorId - Who snoozed them, or null.
   * @param reason - Why, optional.
   * @returns The event and the items it caught; `eventId` null when nothing was open.
   */
  async snoozeAll(
    organizationId: string,
    until: Date,
    actorId: string | null,
    reason: string | null,
  ): Promise<{ eventId: string | null; items: string[] }> {
    const result = await sql<{ event_id: string | null }>`
      select ouroboros.decision_items_snooze_all(${organizationId}, ${until}, ${actorId}, ${reason}) as event_id
    `.execute(this.database.db);
    const eventId = result.rows[0]?.event_id ?? null;

    if (eventId === null) {
      return { eventId: null, items: [] };
    }

    const event = await sql<{ items: string[] }>`
      select items::text[] as items from ouroboros.decision_snooze_events where id = ${eventId}::uuid
    `.execute(this.database.db);

    return { eventId, items: event.rows[0]?.items ?? [] };
  }

  /**
   * Bring snoozed items back now — one, or every snoozed item of the workspace. Their age never
   * stopped counting.
   *
   * @param organizationId - The workspace.
   * @param itemId - One item, or null for all.
   * @returns The items re-opened.
   */
  async unsnooze(organizationId: string, itemId: string | null): Promise<string[]> {
    let query = this.database.db
      .updateTable("decision_items")
      .set({ status: "open", snoozed_until: null, snoozed_by: null, snooze_reason: null })
      .where("organization_id", "=", organizationId)
      .where("status", "=", "snoozed");

    if (itemId !== null) {
      query = query.where("id", "=", itemId);
    }

    const rows = await query.returning("id").execute();

    return rows.map((row) => row.id);
  }
}
