/**
 * The delivery pipeline (BR.3, [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * ```
 * fan out    webhook_outbox (undispatched) ─▶ one pending attempt per subscribed active endpoint
 * deliver    due attempts (leased) ─▶ sign ─▶ POST ─▶ settle
 * settle     2xx            succeeded
 *            otherwise      failed + next attempt after backoff      while attempts remain
 *                           dead_lettered                            when they are spent, or a
 *                                                                    redelivery failed
 * ```
 *
 * **At-least-once.** An attempt is leased, not deleted, while it is in flight: an instance that
 * dies after the POST and before the settle leaves the attempt pending, and it is sent again once
 * the lease lapses — with the same `X-Ouro-Delivery`, which is how a receiver drops the duplicate.
 *
 * **Matching is the registry's** (`subscriptionMatches`): exact family or exact type, at the
 * endpoint's registry version. An endpoint created after an event is not sent it.
 *
 * **The body is stable across attempts**; the timestamp and signature are per attempt.
 */

import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import type { WebhookDelivery } from "../db/schema";
import { VaultService } from "../vault/vault.service";
import { retryDelayMs } from "./webhook.backoff";
import { failureReason, responseExcerpt } from "./webhook.capture";
import { PING_EVENT, subscriptionMatches } from "./webhook.registry";
import { signedHeaders } from "./webhook.signing";
import {
  WEBHOOK_TRANSPORT,
  WebhookTransportError,
  type WebhookTransport,
} from "./webhook.transport";
import {
  WebhooksRepository,
  type ClaimedDelivery,
  type NewDelivery,
  type Settlement,
} from "./webhooks.repository";

/** Outbox events taken per fan-out batch. */
export const FAN_OUT_BATCH = 100;

/** Batches one tick may fan out before it yields to delivery. */
export const FAN_OUT_MAX_BATCHES = 10;

/** Attempts one tick sends. */
export const DELIVERY_BATCH = 25;

/** How long a claimed attempt is held before another instance may take it — two minutes. */
export const DELIVERY_LEASE_MS = 120_000;

/** What one attempt's body says — the documented payload contract. */
export interface DeliveryBody {
  /** The idempotency key — also `X-Ouro-Delivery`. */
  readonly id: string;
  readonly type: string;
  /** The outbox event; `null` for a ping. */
  readonly eventId: string | null;
  readonly occurredAt: string;
  readonly workspaceId: string;
  readonly registryVersion: number;
  readonly data: Record<string, unknown>;
}

/** What `tick` did. */
export interface DispatchReport {
  /** Events moved from the outbox into delivery queues. */
  readonly fannedOut: number;
  /** Attempts queued by the fan-out. */
  readonly queued: number;
  /** Attempts sent. */
  readonly sent: number;
}

/** The randomness the backoff jitters with, injectable for tests. */
export const WEBHOOK_RANDOM = "ouroboros:webhooks:random";

@Injectable()
export class WebhookDispatcher {
  /**
   * @param deliveries - The statements.
   * @param vault - Opens each endpoint's sealed signing secret.
   * @param transport - The way out of the process.
   * @param config - The attempt budget.
   * @param random - The jitter's source.
   */
  constructor(
    private readonly deliveries: WebhooksRepository,
    private readonly vault: VaultService,
    @Inject(WEBHOOK_TRANSPORT) private readonly transport: WebhookTransport,
    private readonly config: AppConfigService,
    @Inject(WEBHOOK_RANDOM) private readonly random: () => number,
  ) {}

  /**
   * One dispatcher tick: fan out what is new, then send what is due.
   *
   * @param now - The instant to judge against.
   * @returns What it did.
   */
  async tick(now: Date = new Date()): Promise<DispatchReport> {
    let fannedOut = 0;
    let queued = 0;

    for (let batch = 0; batch < FAN_OUT_MAX_BATCHES; batch += 1) {
      const result = await this.fanOut(now);

      fannedOut += result.events;
      queued += result.queued;

      if (result.events < FAN_OUT_BATCH) break;
    }

    const sent = await this.deliverDue(now);

    return { fannedOut, queued, sent };
  }

  /**
   * Move one batch of outbox events into delivery queues, in one transaction: an event is stamped
   * dispatched exactly when its attempts exist.
   *
   * @param now - When the attempts become due.
   * @returns How many events were taken and how many attempts queued.
   */
  async fanOut(now: Date): Promise<{ events: number; queued: number }> {
    return this.deliveries.transaction(async (trx) => {
      const events = await this.deliveries.claimUndispatched(trx, FAN_OUT_BATCH);

      if (events.length === 0) return { events: 0, queued: 0 };

      const endpoints = await this.deliveries.activeEndpoints(trx, [
        ...new Set(events.map((event) => event.organization_id)),
      ]);
      const attempts: NewDelivery[] = [];

      for (const event of events) {
        for (const endpoint of endpoints) {
          if (
            endpoint.organization_id === event.organization_id &&
            endpoint.created_at.getTime() <= event.occurred_at.getTime() &&
            subscriptionMatches(
              endpoint.event_families,
              endpoint.registry_version,
              event.event_type,
            )
          ) {
            attempts.push({
              organizationId: event.organization_id,
              endpointId: endpoint.id,
              eventType: event.event_type,
              eventId: event.id,
              deliveryKey: randomUUID(),
              attempt: 1,
              nextAttemptAt: now,
            });
          }
        }
      }

      await this.deliveries.insertDeliveries(attempts, trx);
      await this.deliveries.markDispatched(
        trx,
        events.map((event) => event.id),
        now,
      );

      return { events: events.length, queued: attempts.length };
    });
  }

  /**
   * Send every attempt now due (up to a batch), one after another, and settle each.
   *
   * @param now - The instant to judge "due" against.
   * @returns How many were sent.
   */
  async deliverDue(now: Date): Promise<number> {
    const claimed = await this.deliveries.claimDue(
      now,
      new Date(now.getTime() + DELIVERY_LEASE_MS),
      DELIVERY_BATCH,
    );

    for (const attempt of claimed) {
      const settlement = await this.send(attempt, now);

      await this.settle(attempt.delivery, settlement);
    }

    return claimed.length;
  }

  /**
   * Send one attempt and say how it went. Writes nothing.
   *
   * @param claimed - The attempt and its endpoint.
   * @param at - When the attempt is made — the tick's instant, so the retry schedule is measured
   *   from the clock the tick judged "due" by. Latency is measured on the wall clock regardless.
   * @returns The settlement to record — `succeeded` on a 2xx, `failed` otherwise (whether that
   *   becomes a retry or a dead letter is {@link settle}'s question).
   */
  async send(claimed: ClaimedDelivery, at: Date = new Date()): Promise<Settlement> {
    const { delivery } = claimed;
    const startedAt = at;
    const started = Date.now();
    const body = await this.body(claimed);

    if (body === undefined) {
      return failed(startedAt, 0, "the event is no longer in the outbox (purged by retention)");
    }

    let secret: string;

    try {
      secret = await this.vault.decryptText(
        delivery.organization_id,
        delivery.endpoint_id,
        claimed.hmacKeySealed,
      );
    } catch {
      // One endpoint whose key cannot be opened (a DEK destroyed, an envelope from elsewhere)
      // fails its own attempt — never the tick, and never by sending an unsigned request.
      return failed(startedAt, 0, "the signing secret could not be opened; rotate it");
    }

    const text = JSON.stringify(body);
    const headers = signedHeaders({
      secret,
      eventType: delivery.event_type,
      deliveryKey: delivery.delivery_key,
      body: text,
      at: startedAt,
    });

    try {
      const response = await this.transport.send({ url: claimed.url, headers, body: text });
      const latencyMs = Date.now() - started;
      const ok = response.status >= 200 && response.status <= 299;

      return {
        status: ok ? "succeeded" : "failed",
        responseCode: response.status >= 100 && response.status <= 599 ? response.status : null,
        latencyMs,
        responseExcerpt: responseExcerpt(response.body),
        error: ok ? null : failureReason(`HTTP ${String(response.status)}`),
        attemptedAt: startedAt,
      };
    } catch (error) {
      const message =
        error instanceof WebhookTransportError ? error.message : "the request could not be sent";

      return failed(startedAt, Date.now() - started, message);
    }
  }

  /**
   * Record an attempt's outcome, and queue what follows it, in one transaction.
   *
   * A ping is never retried. A redelivery (an event already dead-lettered once) gets one try and
   * returns to the DLQ on failure. Anything else is retried with backoff until
   * `OURO_WEBHOOK_MAX_ATTEMPTS`, then dead-lettered.
   *
   * @param delivery - The attempt, as claimed.
   * @param settlement - What {@link send} said.
   */
  async settle(delivery: WebhookDelivery, settlement: Settlement): Promise<void> {
    await this.deliveries.transaction(async (trx) => {
      if (settlement.status === "succeeded" || delivery.event_type === PING_EVENT) {
        await this.deliveries.settle(trx, delivery.id, settlement);
        return;
      }

      const redelivery = await this.deliveries.wasDeadLettered(
        trx,
        delivery.delivery_key,
        delivery.attempt,
      );
      const exhausted = redelivery || delivery.attempt >= this.config.webhookMaxAttempts;

      const settled = await this.deliveries.settle(trx, delivery.id, {
        ...settlement,
        status: exhausted ? "dead_lettered" : "failed",
      });

      if (!settled || exhausted) return;

      await this.deliveries.insertDeliveries(
        [
          {
            organizationId: delivery.organization_id,
            endpointId: delivery.endpoint_id,
            eventType: delivery.event_type,
            eventId: delivery.event_id,
            deliveryKey: delivery.delivery_key,
            attempt: delivery.attempt + 1,
            nextAttemptAt: new Date(
              settlement.attemptedAt.getTime() + retryDelayMs(delivery.attempt, this.random),
            ),
          },
        ],
        trx,
      );
    });
  }

  /**
   * The body an attempt sends.
   *
   * @param claimed - The attempt.
   * @returns The body, or `undefined` when its event is gone from the outbox.
   */
  private async body(claimed: ClaimedDelivery): Promise<DeliveryBody | undefined> {
    const { delivery } = claimed;

    if (delivery.event_type === PING_EVENT || delivery.event_id === null) {
      return {
        id: delivery.delivery_key,
        type: PING_EVENT,
        eventId: null,
        occurredAt: delivery.attempted_at.toISOString(),
        workspaceId: delivery.organization_id,
        registryVersion: claimed.registryVersion,
        data: {
          endpointId: delivery.endpoint_id,
          message: "Test delivery from Ouroboros. Verify the signature, then answer 2xx.",
        },
      };
    }

    const event = await this.deliveries.outboxEvent(delivery.organization_id, delivery.event_id);

    if (event === undefined) return undefined;

    return {
      id: delivery.delivery_key,
      type: event.event_type,
      eventId: event.id,
      occurredAt: event.occurred_at.toISOString(),
      workspaceId: event.organization_id,
      registryVersion: claimed.registryVersion,
      data: event.payload,
    };
  }
}

/**
 * A failed attempt with no response.
 *
 * @param at - When it started.
 * @param latencyMs - How long it took to fail.
 * @param message - Why.
 * @returns The settlement.
 */
function failed(at: Date, latencyMs: number, message: string): Settlement {
  return {
    status: "failed",
    responseCode: null,
    latencyMs,
    responseExcerpt: null,
    error: failureReason(message),
    attemptedAt: at,
  };
}
