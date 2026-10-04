/**
 * Every statement the webhook pipeline issues (BR.3, [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * ```
 * endpoints    list · find · insert · update · delete · name/SIEM checks
 * outbox       claim undispatched (skip locked) · mark dispatched · read one event
 * deliveries   insert · claim due (lease, skip locked) · settle · page · health · redeliverable
 * ```
 *
 * **Every management statement carries the workspace.** The id in the path is a claim; the
 * workspace comes from the tenant context. The dispatcher's statements are the exception, and on
 * purpose: they serve every workspace, and each row they touch carries its own `organization_id`
 * forward into everything it writes.
 *
 * **Claims are `for update skip locked`**, so two REST instances running the dispatcher never
 * take the same outbox row or the same attempt; a crashed instance's claim lapses with its lease.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type {
  Database,
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEndpoint,
  WebhookOutboxEvent,
} from "../db/schema";
import type { PageWindow } from "../tenancy/pagination";

/** Anything a statement can be issued on. */
type Executor = DatabaseService["db"] | Transaction<Database>;

/** An endpoint row, with the secret's envelope left out — the shape every reader gets. */
export type EndpointRow = Omit<WebhookEndpoint, "hmac_key_sealed">;

/** What a new endpoint is written with. */
export interface NewEndpoint {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly description: string | null;
  readonly url: string;
  readonly hmacKeySealed: string;
  readonly eventFamilies: readonly string[];
  readonly siem: boolean;
  readonly active: boolean;
  readonly registryVersion: number;
  readonly createdBy: string;
}

/** An edit — only the fields present are written. */
export interface EndpointChanges {
  readonly name?: string;
  readonly description?: string | null;
  readonly url?: string;
  readonly hmacKeySealed?: string;
  readonly eventFamilies?: readonly string[];
  readonly siem?: boolean;
  readonly active?: boolean;
  readonly registryVersion?: number;
}

/** A delivery attempt to queue. */
export interface NewDelivery {
  readonly organizationId: string;
  readonly endpointId: string;
  readonly eventType: string;
  readonly eventId: string | null;
  readonly deliveryKey: string;
  readonly attempt: number;
  readonly nextAttemptAt: Date;
}

/** How an attempt ended. */
export interface Settlement {
  readonly status: Exclude<WebhookDeliveryStatus, "pending">;
  readonly responseCode: number | null;
  readonly latencyMs: number;
  readonly responseExcerpt: string | null;
  readonly error: string | null;
  readonly attemptedAt: Date;
}

/** One claimed attempt, with what sending it needs. */
export interface ClaimedDelivery {
  readonly delivery: WebhookDelivery;
  readonly url: string;
  readonly hmacKeySealed: string;
  readonly registryVersion: number;
}

/** A delivery-log row, with whether an administrator may redeliver it. */
export interface DeliveryLogRow extends WebhookDelivery {
  /** The latest attempt at its event and dead-lettered. */
  readonly redeliverable: boolean;
}

/** One endpoint's delivery health, as counted from its log. */
export interface EndpointHealthRow {
  readonly endpoint_id: string;
  /** Events whose latest attempt is dead-lettered — the open DLQ. */
  readonly dead_lettered: number;
  /** Retries waiting (pending attempts after the first). */
  readonly retrying: number;
  /** The newest settled, non-ping attempt. */
  readonly last_status: WebhookDeliveryStatus | null;
  readonly last_response_code: number | null;
  readonly last_attempted_at: Date | null;
  /** The newest success, non-ping. */
  readonly last_succeeded_at: Date | null;
}

/** The test event's type, kept out of every health count. */
const PING = "ping";

/** The columns every endpoint reader selects — everything but the envelope. */
const ENDPOINT_COLUMNS = [
  "id",
  "organization_id",
  "name",
  "description",
  "url",
  "event_families",
  "siem",
  "active",
  "registry_version",
  "created_by",
  "created_at",
  "updated_at",
] as const;

@Injectable()
export class WebhooksRepository {
  /**
   * @param database - The typed connection.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Run `work` in one transaction.
   *
   * @param work - The statements.
   * @returns What `work` returned.
   */
  transaction<T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  // --- endpoints ---------------------------------------------------------------------------

  /**
   * The workspace's endpoints, oldest first.
   *
   * @param organizationId - The workspace.
   * @returns The rows, secret envelopes left out.
   */
  list(organizationId: string): Promise<EndpointRow[]> {
    return this.database.db
      .selectFrom("webhook_endpoints")
      .select(ENDPOINT_COLUMNS)
      .where("organization_id", "=", organizationId)
      .orderBy("created_at")
      .orderBy("id")
      .execute();
  }

  /**
   * One endpoint.
   *
   * @param organizationId - The workspace.
   * @param id - The endpoint.
   * @param executor - A transaction, when inside one.
   * @returns The row, secret envelope left out, or `undefined`.
   */
  find(
    organizationId: string,
    id: string,
    executor: Executor = this.database.db,
  ): Promise<EndpointRow | undefined> {
    return executor
      .selectFrom("webhook_endpoints")
      .select(ENDPOINT_COLUMNS)
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /**
   * One endpoint's sealed signing secret — for the ping, which signs in the request.
   *
   * @param organizationId - The workspace.
   * @param id - The endpoint.
   * @returns The envelope, or `undefined`.
   */
  async sealedSecret(organizationId: string, id: string): Promise<string | undefined> {
    const row = await this.database.db
      .selectFrom("webhook_endpoints")
      .select("hmac_key_sealed")
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();

    return row?.hmac_key_sealed;
  }

  /**
   * Whether another endpoint of the workspace has this name.
   *
   * @param trx - The transaction.
   * @param organizationId - The workspace.
   * @param name - The name.
   * @param exceptId - The endpoint being renamed, which may keep its own name.
   * @returns `true` when taken.
   */
  async nameTaken(
    trx: Executor,
    organizationId: string,
    name: string,
    exceptId?: string,
  ): Promise<boolean> {
    let query = trx
      .selectFrom("webhook_endpoints")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("name", "=", name);

    if (exceptId !== undefined) query = query.where("id", "<>", exceptId);

    return (await query.executeTakeFirst()) !== undefined;
  }

  /**
   * The workspace's SIEM endpoint other than this one, if there is one.
   *
   * @param trx - The transaction.
   * @param organizationId - The workspace.
   * @param exceptId - The endpoint being edited.
   * @returns The other SIEM endpoint's id, or `undefined`.
   */
  async otherSiem(
    trx: Executor,
    organizationId: string,
    exceptId?: string,
  ): Promise<string | undefined> {
    let query = trx
      .selectFrom("webhook_endpoints")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("siem", "=", true);

    if (exceptId !== undefined) query = query.where("id", "<>", exceptId);

    return (await query.executeTakeFirst())?.id;
  }

  /**
   * Write a new endpoint.
   *
   * @param trx - The transaction.
   * @param endpoint - The row.
   */
  async insert(trx: Executor, endpoint: NewEndpoint): Promise<void> {
    await trx
      .insertInto("webhook_endpoints")
      .values({
        id: endpoint.id,
        organization_id: endpoint.organizationId,
        name: endpoint.name,
        description: endpoint.description,
        url: endpoint.url,
        hmac_key_sealed: endpoint.hmacKeySealed,
        event_families: JSON.stringify(endpoint.eventFamilies),
        siem: endpoint.siem,
        active: endpoint.active,
        registry_version: endpoint.registryVersion,
        created_by: endpoint.createdBy,
      })
      .execute();
  }

  /**
   * Write an edit.
   *
   * @param trx - The transaction.
   * @param organizationId - The workspace.
   * @param id - The endpoint.
   * @param changes - The fields to write; absent fields are untouched.
   */
  async update(
    trx: Executor,
    organizationId: string,
    id: string,
    changes: EndpointChanges,
  ): Promise<void> {
    await trx
      .updateTable("webhook_endpoints")
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.description !== undefined ? { description: changes.description } : {}),
        ...(changes.url !== undefined ? { url: changes.url } : {}),
        ...(changes.hmacKeySealed !== undefined ? { hmac_key_sealed: changes.hmacKeySealed } : {}),
        ...(changes.eventFamilies !== undefined
          ? { event_families: JSON.stringify(changes.eventFamilies) }
          : {}),
        ...(changes.siem !== undefined ? { siem: changes.siem } : {}),
        ...(changes.active !== undefined ? { active: changes.active } : {}),
        ...(changes.registryVersion !== undefined
          ? { registry_version: changes.registryVersion }
          : {}),
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .execute();
  }

  /**
   * Delete an endpoint; its delivery log cascades (V094).
   *
   * @param organizationId - The workspace.
   * @param id - The endpoint.
   * @returns Whether a row was deleted.
   */
  async delete(organizationId: string, id: string): Promise<boolean> {
    const result = await this.database.db
      .deleteFrom("webhook_endpoints")
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();

    return result.numDeletedRows > 0n;
  }

  /**
   * Every endpoint's delivery health, counted from its log. Pings are left out: a test delivery
   * says nothing about whether real events arrive.
   *
   * @param organizationId - The workspace.
   * @returns One row per endpoint that has any non-ping attempt.
   */
  async health(organizationId: string): Promise<EndpointHealthRow[]> {
    const result = await sql<EndpointHealthRow>`
      with log as (
        select d.*,
               row_number() over (partition by d.delivery_key order by d.attempt desc) as newest
          from ouroboros.webhook_deliveries d
         where d.organization_id = ${organizationId}
           and d.event_type <> ${PING}
      ),
      settled as (
        select distinct on (endpoint_id) endpoint_id, status, response_code, attempted_at
          from log
         where status <> 'pending'
         order by endpoint_id, attempted_at desc, attempt desc
      )
      select e.id as endpoint_id,
             (select count(*)::int from log l
               where l.endpoint_id = e.id and l.newest = 1 and l.status = 'dead_lettered') as dead_lettered,
             (select count(*)::int from log l
               where l.endpoint_id = e.id and l.status = 'pending' and l.attempt > 1) as retrying,
             s.status as last_status,
             s.response_code as last_response_code,
             s.attempted_at as last_attempted_at,
             (select max(l.attempted_at) from log l
               where l.endpoint_id = e.id and l.status = 'succeeded') as last_succeeded_at
        from ouroboros.webhook_endpoints e
        left join settled s on s.endpoint_id = e.id
       where e.organization_id = ${organizationId}
    `.execute(this.database.db);

    return result.rows;
  }

  // --- deliveries --------------------------------------------------------------------------

  /**
   * Queue attempts.
   *
   * @param deliveries - The attempts, each `pending`.
   * @param executor - The transaction (the fan-out's, the redelivery's, the retry's); the pool for
   *   the ping, which has no change to share one with.
   * @returns The rows as written.
   */
  async insertDeliveries(
    deliveries: readonly NewDelivery[],
    executor: Executor = this.database.db,
  ): Promise<WebhookDelivery[]> {
    if (deliveries.length === 0) return [];

    return executor
      .insertInto("webhook_deliveries")
      .values(
        deliveries.map((delivery) => ({
          organization_id: delivery.organizationId,
          endpoint_id: delivery.endpointId,
          event_type: delivery.eventType,
          event_id: delivery.eventId,
          delivery_key: delivery.deliveryKey,
          attempt: delivery.attempt,
          status: "pending" as const,
          next_attempt_at: delivery.nextAttemptAt,
        })),
      )
      .returningAll()
      .execute();
  }

  /**
   * Take every attempt now due, for active endpoints, and lease it.
   *
   * Leasing is pushing `next_attempt_at` to `leaseUntil`: the row stays `pending`, so an instance
   * that dies mid-send leaves it to be taken again once the lease lapses — at-least-once.
   * Attempts for a disabled endpoint are not taken; they resume when it is switched back on.
   *
   * @param now - The instant to judge "due" against.
   * @param leaseUntil - When the claim lapses.
   * @param limit - The most to take.
   * @returns The claimed attempts, each with its endpoint's URL, envelope and registry version.
   */
  async claimDue(now: Date, leaseUntil: Date, limit: number): Promise<ClaimedDelivery[]> {
    return this.database.transaction(async (trx) => {
      const due = await trx
        .selectFrom("webhook_deliveries as d")
        .innerJoin("webhook_endpoints as e", "e.id", "d.endpoint_id")
        .select("d.id")
        .where("d.status", "=", "pending")
        .where("d.next_attempt_at", "<=", now)
        .where("e.active", "=", true)
        .orderBy("d.next_attempt_at")
        .limit(limit)
        .forUpdate("d")
        .skipLocked()
        .execute();

      if (due.length === 0) return [];

      const leased = await trx
        .updateTable("webhook_deliveries")
        .set({ next_attempt_at: leaseUntil })
        .where(
          "id",
          "in",
          due.map((row) => row.id),
        )
        .returningAll()
        .execute();

      const endpoints = await trx
        .selectFrom("webhook_endpoints")
        .select(["id", "url", "hmac_key_sealed", "registry_version"])
        .where("id", "in", [...new Set(leased.map((row) => row.endpoint_id))])
        .execute();
      const byId = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));

      return leased.flatMap((delivery) => {
        const endpoint = byId.get(delivery.endpoint_id);

        return endpoint === undefined
          ? []
          : [
              {
                delivery,
                url: endpoint.url,
                hmacKeySealed: endpoint.hmac_key_sealed,
                registryVersion: endpoint.registry_version,
              },
            ];
      });
    });
  }

  /**
   * Record how an attempt ended. Only a pending attempt can be settled — a second settle of the
   * same attempt (two instances racing past a lapsed lease) changes nothing.
   *
   * @param executor - The transaction (the retry is queued in the same one).
   * @param id - The attempt.
   * @param settlement - The outcome.
   * @returns Whether this call settled it.
   */
  async settle(executor: Executor, id: string, settlement: Settlement): Promise<boolean> {
    const result = await executor
      .updateTable("webhook_deliveries")
      .set({
        status: settlement.status,
        response_code: settlement.responseCode,
        latency_ms: settlement.latencyMs,
        response_excerpt: settlement.responseExcerpt,
        error: settlement.error,
        attempted_at: settlement.attemptedAt,
        next_attempt_at: null,
      })
      .where("id", "=", id)
      .where("status", "=", "pending")
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  /**
   * Whether an event's earlier attempts include a dead letter — so the attempt now settling is a
   * redelivery, which gets one try and returns to the DLQ on failure.
   *
   * @param executor - The transaction.
   * @param deliveryKey - The event-for-endpoint key.
   * @param beforeAttempt - The attempt settling now.
   * @returns `true` when an earlier attempt was dead-lettered.
   */
  async wasDeadLettered(
    executor: Executor,
    deliveryKey: string,
    beforeAttempt: number,
  ): Promise<boolean> {
    const row = await executor
      .selectFrom("webhook_deliveries")
      .select("id")
      .where("delivery_key", "=", deliveryKey)
      .where("attempt", "<", beforeAttempt)
      .where("status", "=", "dead_lettered")
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * One attempt of an endpoint, with whether it may be redelivered.
   *
   * @param organizationId - The workspace.
   * @param endpointId - The endpoint.
   * @param id - The attempt.
   * @param executor - A transaction, when inside one.
   * @returns The row, or `undefined`.
   */
  async findDelivery(
    organizationId: string,
    endpointId: string,
    id: string,
    executor: Executor = this.database.db,
  ): Promise<DeliveryLogRow | undefined> {
    return executor
      .selectFrom("webhook_deliveries as d")
      .selectAll("d")
      .select(redeliverable)
      .where("d.organization_id", "=", organizationId)
      .where("d.endpoint_id", "=", endpointId)
      .where("d.id", "=", id)
      .executeTakeFirst();
  }

  /**
   * The highest attempt number an event has had at an endpoint.
   *
   * @param executor - The transaction.
   * @param deliveryKey - The key.
   * @returns The attempt number.
   */
  async lastAttempt(executor: Executor, deliveryKey: string): Promise<number> {
    const row = await executor
      .selectFrom("webhook_deliveries")
      .select((eb) => eb.fn.max("attempt").as("attempt"))
      .where("delivery_key", "=", deliveryKey)
      .executeTakeFirst();

    return Number(row?.attempt ?? 0);
  }

  /**
   * One page of an endpoint's delivery log, newest first.
   *
   * @param organizationId - The workspace.
   * @param endpointId - The endpoint.
   * @param status - Only attempts in this status, when given.
   * @param window - The page.
   * @returns The rows and the total under the same filter.
   */
  async page(
    organizationId: string,
    endpointId: string,
    status: WebhookDeliveryStatus | undefined,
    window: PageWindow,
  ): Promise<{ rows: DeliveryLogRow[]; total: number }> {
    let scoped = this.database.db
      .selectFrom("webhook_deliveries as d")
      .where("d.organization_id", "=", organizationId)
      .where("d.endpoint_id", "=", endpointId);

    if (status !== undefined) scoped = scoped.where("d.status", "=", status);

    const rows = await scoped
      .selectAll("d")
      .select(redeliverable)
      .orderBy("d.attempted_at", "desc")
      .orderBy("d.attempt", "desc")
      .orderBy("d.id", "desc")
      .limit(window.limit)
      .offset(window.offset)
      .execute();
    const counted = await scoped
      .select((eb) => eb.fn.countAll<string>().as("total"))
      .executeTakeFirstOrThrow();

    return { rows, total: Number(counted.total) };
  }

  // --- outbox ------------------------------------------------------------------------------

  /**
   * Take the oldest undispatched events.
   *
   * @param trx - The fan-out's transaction; the claim holds until it commits.
   * @param limit - The most to take.
   * @returns The events.
   */
  claimUndispatched(trx: Transaction<Database>, limit: number): Promise<WebhookOutboxEvent[]> {
    return trx
      .selectFrom("webhook_outbox")
      .selectAll()
      .where("dispatched_at", "is", null)
      .orderBy("occurred_at")
      .orderBy("id")
      .limit(limit)
      .forUpdate()
      .skipLocked()
      .execute();
  }

  /**
   * The active endpoints of some workspaces, with their subscriptions — the fan-out's candidates.
   *
   * @param trx - The fan-out's transaction.
   * @param organizationIds - The workspaces the claimed events belong to.
   * @returns The endpoints.
   */
  activeEndpoints(
    trx: Transaction<Database>,
    organizationIds: readonly string[],
  ): Promise<EndpointRow[]> {
    if (organizationIds.length === 0) return Promise.resolve([]);

    return trx
      .selectFrom("webhook_endpoints")
      .select(ENDPOINT_COLUMNS)
      .where("organization_id", "in", [...organizationIds])
      .where("active", "=", true)
      .execute();
  }

  /**
   * Stamp events as handed to every subscribed endpoint.
   *
   * @param trx - The fan-out's transaction.
   * @param ids - The events.
   * @param at - When.
   */
  async markDispatched(
    trx: Transaction<Database>,
    ids: readonly string[],
    at: Date,
  ): Promise<void> {
    if (ids.length === 0) return;

    await trx
      .updateTable("webhook_outbox")
      .set({ dispatched_at: at })
      .where("id", "in", [...ids])
      .execute();
  }

  /**
   * One outbox event — what an attempt sends.
   *
   * @param organizationId - The workspace the attempt belongs to.
   * @param id - The event.
   * @returns The event, or `undefined` once it has been purged.
   */
  outboxEvent(organizationId: string, id: string): Promise<WebhookOutboxEvent | undefined> {
    return this.database.db
      .selectFrom("webhook_outbox")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();
  }
}

/**
 * `redeliverable` for a delivery row aliased `d`: dead-lettered, and no later attempt at its event.
 *
 * @returns The selection.
 */
function redeliverable() {
  return sql<boolean>`(d.status = 'dead_lettered' and not exists (
    select 1 from ouroboros.webhook_deliveries later
     where later.delivery_key = d.delivery_key and later.attempt > d.attempt))`.as("redeliverable");
}
