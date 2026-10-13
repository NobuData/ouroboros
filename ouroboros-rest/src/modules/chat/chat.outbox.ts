/**
 * Writing the chat outbox (BZ.2, [#536](https://github.com/NobuData/ouroboros/issues/536)) —
 * plain functions on whatever executor the caller holds.
 *
 * ```
 * plane event ──▶ route evaluation ──▶ chat_outbox ──▶ (dispatcher) ──▶ Slack · chat_messages
 *                 ▲ this file
 * ```
 *
 * **In the caller's transaction.** A plane that finishes a run calls {@link enqueueChatIntent}
 * with the transaction that finished it, exactly as it calls `enqueueWebhookEvents` (#487): the
 * intent to say so exists if and only if the thing happened. Nothing here talks to a platform.
 *
 * **Route evaluation is the same statement.** Where a message goes is the workspace's
 * notification routes (#488, decision C6): each enabled Slack route of a kind the event rides
 * contributes its bound channel, and — when it is a *DM on-call* route — the linked chat identity
 * of the workspace's on-call member. A workspace with no active Slack connection, no such route
 * or nobody on call contributes no row, and the call writes nothing.
 *
 * **The same thing is intended once.** Each row carries the SHA-256 of what it is about
 * ({@link chatDedupeKey}); V134's unique indexes make a second enqueue of it for the same target a
 * no-op, so a plane that reports twice, or two replicas that both notice a due digest, produce
 * one message.
 *
 * This file imports no Nest module and nothing from `slack/`, so any plane — and the Slack module
 * itself — may call it without closing a cycle.
 */

import { createHash } from "node:crypto";

import { sql, type Kysely, type Transaction } from "kysely";

import type { ChatEventFamily, Database } from "../db/schema";

/** Whatever the caller is writing with. */
export type ChatOutboxExecutor = Kysely<Database> | Transaction<Database>;

/**
 * Which notification routes each kind of message rides (decision C6; mockup 19's *What gets
 * published where*). The `custom:*` kinds are the mockup's rows; the core kinds (#488) deliver
 * too when a workspace binds them to Slack.
 */
export const CHAT_ROUTE_KINDS = {
  decision: ["custom:blocking-questions", "needs_you_dm"],
  loop_finished: ["custom:loop-finished"],
  build_green: ["custom:stage-transitions"],
  build_failed: ["custom:build-failures", "loop_failures"],
  digest: ["custom:weekly-insights", "weekly_insights"],
} as const satisfies Record<"decision" | ChatEventFamily, readonly string[]>;

/** The route kind that is a DM by nature, whether or not `dm_on_call` is set on it. */
export const DM_ROUTE_KIND = "needs_you_dm";

/** The `purpose_tag` of a `chat_channels` row that is a DM conversation, not a channel. */
export const DM_PURPOSE_TAG = "dm";

/** The on-call scope decisions escalate to (V132's default). */
export const ON_CALL_SCOPE = "decisions";

/** Something to say, before it is known where. */
export interface ChatIntent {
  readonly organizationId: string;
  readonly messageKind: "decision_card" | "event_card";
  /** A decision card's kind id, or an event card's family. */
  readonly cardKind: string;
  /** The decision, for a decision card. */
  readonly decisionItemId?: string;
  /** What the renderer will read — ids and instants, never prose. */
  readonly subject: Readonly<Record<string, unknown>>;
  /** The route kinds this message rides — a member of {@link CHAT_ROUTE_KINDS}. */
  readonly routeKinds: readonly string[];
  /** What the message is about, as {@link chatDedupeKey}'s parts. */
  readonly dedupe: readonly string[];
}

/**
 * The dedupe key of an intent.
 *
 * @param parts - What the message is about — `["loop_finished", runId]`. Never rendered text:
 *   two renderings of one event are still one event.
 * @returns SHA-256, lower-case hex.
 */
export function chatDedupeKey(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u001f"), "utf8").digest("hex");
}

/**
 * Evaluate the workspace's routes for an intent and write one outbox row per target.
 *
 * @param executor - The caller's transaction (or the pool, for a caller with none).
 * @param intent - What to say.
 * @returns How many rows were written — 0 when no route delivers it anywhere, or every target
 *   already has it.
 */
export async function enqueueChatIntent(
  executor: ChatOutboxExecutor,
  intent: ChatIntent,
): Promise<number> {
  if (intent.routeKinds.length === 0) {
    return 0;
  }

  const kinds = sql.join(intent.routeKinds.map((kind) => sql`${kind}`));
  const { rows } = await sql<{ id: string }>`
    with routes as (
      select r.kind, r.chat_channel_id, r.dm_on_call, c.id as connection_id
        from ouroboros.notification_routes r
        join ouroboros.chat_connections c
          on c.organization_id = r.organization_id and c.platform = 'slack' and c.status = 'active'
       where r.organization_id = ${intent.organizationId}
         and r.channel = 'slack'
         and r.enabled
         and r.kind in (${kinds})
    ),
    targets as (
      select routes.connection_id, routes.kind, ch.id as channel_id, null::text as dm_user
        from routes
        join ouroboros.chat_channels ch
          on ch.id = routes.chat_channel_id and ch.connection_id = routes.connection_id
      union all
      select routes.connection_id, routes.kind, null::uuid, link.platform_user_id
        from routes
        join ouroboros.on_call_assignments oncall
          on oncall.organization_id = ${intent.organizationId}
         and oncall.scope = ${ON_CALL_SCOPE}
         and oncall.active
        join ouroboros.chat_identity_links link
          on link.connection_id = routes.connection_id
         and link.member_id = oncall.member_id
         and link.state = 'linked'
       where routes.dm_on_call or routes.kind = ${DM_ROUTE_KIND}
    ),
    -- Two routes may name the same channel; it is told once, on behalf of the first by name.
    chosen as (
      select distinct on (connection_id, channel_id, dm_user)
             connection_id, kind, channel_id, dm_user
        from targets
       order by connection_id, channel_id, dm_user, kind
    )
    insert into ouroboros.chat_outbox
      (organization_id, connection_id, channel_id, dm_platform_user_id, message_kind, card_kind,
       decision_item_id, subject, route_kind, dedupe_key)
    select ${intent.organizationId}, chosen.connection_id, chosen.channel_id, chosen.dm_user,
           ${intent.messageKind}, ${intent.cardKind}, ${intent.decisionItemId ?? null}::uuid,
           ${JSON.stringify(intent.subject)}::jsonb, chosen.kind, ${chatDedupeKey(intent.dedupe)}
      from chosen
    on conflict do nothing
    returning id`.execute(executor);

  return rows.length;
}

/**
 * Intend a *loop finished* card — called by the merge, in its transaction.
 *
 * @param executor - The merge's transaction.
 * @param organizationId - The workspace.
 * @param runId - The run that merged.
 * @returns How many targets it was enqueued for.
 */
export function enqueueLoopFinished(
  executor: ChatOutboxExecutor,
  organizationId: string,
  runId: string,
): Promise<number> {
  return enqueueChatIntent(executor, {
    organizationId,
    messageKind: "event_card",
    cardKind: "loop_finished",
    subject: { run_id: runId },
    routeKinds: CHAT_ROUTE_KINDS.loop_finished,
    dedupe: ["loop_finished", runId],
  });
}

/** What a plane reports about a build, for a build card. */
export interface BuildReport {
  readonly organizationId: string;
  readonly runId: string;
  readonly loopSeq: number;
  /** Which build of the loop, when the plane counts them. */
  readonly buildNumber?: number;
  readonly passed: number;
  readonly total: number;
  readonly prNumber?: number;
  readonly prId?: string;
  readonly revision?: number;
}

/**
 * Intend a *build green* or *build failed* card.
 *
 * **Nothing calls this yet.** No plane in this service reports a build's result as an event
 * (#536's survey: a test run completes with no signal, and nothing moves a run to `failed`), so
 * the entry point exists, is rendered and is tested, and waits for the plane that will call it
 * with the transaction that records the result.
 *
 * @param executor - The reporting plane's transaction.
 * @param family - Which card.
 * @param report - The build's facts.
 * @returns How many targets it was enqueued for.
 */
export function enqueueBuildCard(
  executor: ChatOutboxExecutor,
  family: "build_green" | "build_failed",
  report: BuildReport,
): Promise<number> {
  return enqueueChatIntent(executor, {
    organizationId: report.organizationId,
    messageKind: "event_card",
    cardKind: family,
    subject: {
      run_id: report.runId,
      loop_seq: report.loopSeq,
      passed: report.passed,
      total: report.total,
      ...(report.buildNumber === undefined ? {} : { build_number: report.buildNumber }),
      ...(report.prNumber === undefined ? {} : { pr_number: report.prNumber }),
      ...(report.prId === undefined ? {} : { pr_id: report.prId }),
      ...(report.revision === undefined ? {} : { revision: report.revision }),
    },
    routeKinds: CHAT_ROUTE_KINDS[family],
    dedupe: [family, report.runId, String(report.buildNumber ?? "")],
  });
}

/** How a connection's deliveries stand. */
export interface ChatDeliveryHealthRow {
  /** Rows waiting for their first attempt. */
  readonly pending: number;
  /** Rows that failed at least once and will be tried again. */
  readonly retrying: number;
  /** Rows whose attempts ran out, in the window. */
  readonly deadLettered: number;
  /** Rows still pending after {@link PERSISTENT_RETRY_ATTEMPTS} tries — retrying persistently. */
  readonly stuck: number;
  /** The route kinds with a dead letter in the window or a stuck row, sorted. */
  readonly affectedRoutes: readonly string[];
  /** The most recent dead letter's error and instant, or null. */
  readonly lastError: string | null;
  readonly lastDeadLetteredAt: Date | null;
  /** When a message was last sent, or null. */
  readonly lastSentAt: Date | null;
}

/** How far back a dead letter still counts towards a connection's health. */
export const DEAD_LETTER_WINDOW_DAYS = 7;

/**
 * How many failed attempts make a pending row *persistently* retrying (#545). One failure is
 * weather — a rate limit, a blip — and is retried within the minute; by the third the backoff
 * has run for minutes and something is wrong enough to say so.
 */
export const PERSISTENT_RETRY_ATTEMPTS = 3;

/**
 * The instant the dead-letter window opens.
 *
 * @param now - The instant it is measured from.
 * @returns {@link DEAD_LETTER_WINDOW_DAYS} earlier.
 */
function deadLetterWindowStart(now: Date): Date {
  return new Date(now.getTime() - DEAD_LETTER_WINDOW_DAYS * 86_400_000);
}

/**
 * A connection's delivery health — what the status API and #545's banner read.
 *
 * @param executor - The reader.
 * @param connectionId - The connection.
 * @param now - The instant the window is measured from.
 * @returns The counts.
 */
export async function readChatDeliveryHealth(
  executor: ChatOutboxExecutor,
  connectionId: string,
  now: Date,
): Promise<ChatDeliveryHealthRow> {
  const since = deadLetterWindowStart(now);
  const { rows } = await sql<{
    pending: string;
    retrying: string;
    dead_lettered: string;
    stuck: string;
    affected_routes: string[] | null;
    last_error: string | null;
    last_dead_lettered_at: Date | null;
    last_sent_at: Date | null;
  }>`
    select count(*) filter (where o.status = 'pending' and o.attempts = 0)  as pending,
           count(*) filter (where o.status = 'pending' and o.attempts > 0)  as retrying,
           count(*) filter (where o.status = 'dead_lettered' and o.settled_at >= ${since})
                                                                            as dead_lettered,
           count(*) filter (where o.status = 'pending'
                              and o.attempts >= ${PERSISTENT_RETRY_ATTEMPTS})  as stuck,
           array(select distinct a.route_kind from ouroboros.chat_outbox a
                  where a.connection_id = ${connectionId}::uuid
                    and ((a.status = 'dead_lettered' and a.settled_at >= ${since})
                      or (a.status = 'pending' and a.attempts >= ${PERSISTENT_RETRY_ATTEMPTS}))
                  order by a.route_kind)                                    as affected_routes,
           (select d.last_error from ouroboros.chat_outbox d
             where d.connection_id = ${connectionId}::uuid and d.status = 'dead_lettered'
               and d.settled_at >= ${since}
             order by d.settled_at desc limit 1)                            as last_error,
           max(o.settled_at) filter (where o.status = 'dead_lettered' and o.settled_at >= ${since})
                                                                            as last_dead_lettered_at,
           max(o.settled_at) filter (where o.status = 'sent')               as last_sent_at
      from ouroboros.chat_outbox o
     where o.connection_id = ${connectionId}::uuid`.execute(executor);
  const [row] = rows;

  return {
    pending: Number(row?.pending ?? 0),
    retrying: Number(row?.retrying ?? 0),
    deadLettered: Number(row?.dead_lettered ?? 0),
    stuck: Number(row?.stuck ?? 0),
    affectedRoutes: row?.affected_routes ?? [],
    lastError: row?.last_error ?? null,
    lastDeadLetteredAt: row?.last_dead_lettered_at ?? null,
    lastSentAt: row?.last_sent_at ?? null,
  };
}

/**
 * Queue a connection's dead letters again (#545) — the ones {@link readChatDeliveryHealth}
 * counts: given up on within the window.
 *
 * Each becomes pending and due now with its attempts cleared, so it gets the whole retry
 * schedule again; `last_error` is kept until an attempt replaces it. The row is the same row, so
 * its dedupe key and its message stand and nothing is said twice.
 *
 * @param executor - The writer.
 * @param connectionId - The connection.
 * @param now - The instant the rows become due, and the window is measured from.
 * @returns The route kinds of the rows queued, one per row.
 */
export async function requeueChatDeadLetters(
  executor: ChatOutboxExecutor,
  connectionId: string,
  now: Date,
): Promise<string[]> {
  const { rows } = await sql<{ route_kind: string }>`
    update ouroboros.chat_outbox
       set status = 'pending', attempts = 0, next_attempt_at = ${now}, settled_at = null
     where connection_id = ${connectionId}::uuid
       and status = 'dead_lettered'
       and settled_at >= ${deadLetterWindowStart(now)}
    returning route_kind`.execute(executor);

  return rows.map((row) => row.route_kind);
}
