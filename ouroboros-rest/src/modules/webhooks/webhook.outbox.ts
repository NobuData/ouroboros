/**
 * The one way an event enters the webhook pipeline: a `webhook_outbox` row, written by the
 * caller's own transaction (BR.3, [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * ```
 * transaction { the change · enqueueWebhookEvents(trx, …) }  ──▶  dispatcher (later, elsewhere)
 * ```
 *
 * **Why a function over an executor and not a service.** The guarantee the outbox exists for is
 * *a crash between the change and the event cannot lose the event* — and only the transaction
 * that makes the change can give it. So the writer takes the caller's executor and issues one
 * insert on it; the audit repository, the ingestion contract, the console's cancel and the merge
 * executor each pass the transaction they already hold. Nothing here opens its own.
 *
 * This file imports nothing but the schema mirror's types, so any repository may call it without
 * a dependency cycle.
 */

import type { Kysely, Transaction } from "kysely";

import type { Database } from "../db/schema";

/** Anything a statement can be issued on — the pool, or the caller's transaction. */
export type OutboxExecutor = Kysely<Database> | Transaction<Database>;

/** One event, as its writer hands it over. */
export interface OutboxEvent {
  /** The workspace the event belongs to. */
  readonly organizationId: string;
  /** Every registered type the event is published as — `["audit.decision.filed", "decision.filed"]`. */
  readonly types: readonly string[];
  /** The event's `data` — what a receiver reads. Flat facts, never a credential. */
  readonly data: Record<string, unknown>;
  /** When it happened — the same instant the change itself records. */
  readonly occurredAt: Date;
}

/**
 * Queue an event for delivery, inside the caller's transaction.
 *
 * @param executor - The transaction that makes the change the event records. Passing the pool
 *   instead is allowed only where there is no change to share a transaction with (the purge's
 *   final event, written after the workspace is gone).
 * @param event - The event.
 * @returns The outbox rows' ids, one per type, in `types` order.
 */
export async function enqueueWebhookEvents(
  executor: OutboxExecutor,
  event: OutboxEvent,
): Promise<string[]> {
  if (event.types.length === 0) {
    return [];
  }

  const payload = JSON.stringify(event.data);
  const rows = await executor
    .insertInto("webhook_outbox")
    .values(
      event.types.map((type) => ({
        organization_id: event.organizationId,
        event_type: type,
        payload,
        occurred_at: event.occurredAt,
      })),
    )
    .returning("id")
    .execute();

  return rows.map((row) => row.id);
}
