/**
 * Outbound webhook endpoints — the Integrations card's **Webhooks** tile and the Audit card's
 * **Stream to SIEM** row ([#487](https://github.com/NobuData/ouroboros/issues/487) built them,
 * BS.5 [#495](https://github.com/NobuData/ouroboros/issues/495) draws them).
 *
 * One resource under `/api/v1/settings/webhooks`: the endpoints with their delivery health, the
 * **counted** `activeCount`, the **derived** SIEM row and the event registry; then per endpoint
 * its edit, its secret rotation, its test ping, its delivery log and the redelivery of a
 * dead-lettered event.
 *
 * **A signing secret appears in exactly two answers** — {@link settingsWebhooks.create} and
 * {@link settingsWebhooks.rotateSecret} — and in no read. **Owners and admins only**, all of it.
 *
 * Server-side only, by way of `app/api/server.ts`.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** Every endpoint, the active count, the SIEM row and the registry. */
export type WebhookList = components["schemas"]["WebhookList"];
/** One endpoint. Never carries its signing secret. */
export type WebhookEndpoint = components["schemas"]["WebhookEndpoint"];
/** An endpoint's delivery health, counted from its log. */
export type WebhookHealth = components["schemas"]["WebhookHealth"];
/** The Audit card's *Stream to SIEM* row, derived from the SIEM endpoint's log. */
export type WebhookSiem = components["schemas"]["WebhookSiem"];
/** The versioned event registry, for the subscription picker. */
export type WebhookRegistry = components["schemas"]["WebhookRegistry"];
/** The answer to create and rotate — the only time a signing secret is returned. */
export type WebhookSecret = components["schemas"]["WebhookSecret"];
/** One delivery attempt. */
export type WebhookDelivery = components["schemas"]["WebhookDelivery"];
/** One page of an endpoint's delivery log, newest first. */
export type WebhookDeliveryPage = components["schemas"]["WebhookDeliveryPage"];
/** How an attempt ended, or that it has not yet. */
export type WebhookDeliveryStatus = components["schemas"]["WebhookDeliveryStatus"];
/** What creating an endpoint takes. There is no secret field — the server mints it. */
export type CreateWebhookRequest = components["schemas"]["CreateWebhookRequest"];
/** What editing an endpoint takes — only the fields sent are changed. */
export type UpdateWebhookRequest = components["schemas"]["UpdateWebhookRequest"];

/** Which part of an endpoint's delivery log to read. */
export interface DeliveryQuery {
  /** Only attempts in this status — `dead_lettered` is the dead-letter queue. */
  readonly status?: WebhookDeliveryStatus;
  /** How many rows. */
  readonly limit?: number;
  /** How many rows to skip. */
  readonly offset?: number;
}

/** The webhook endpoints, as `ouroboros-rest` keeps them. */
export const settingsWebhooks = {
  /**
   * Every endpoint, with the active count, the SIEM row and the registry.
   *
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The list.
   * @throws {ApiError} What the service answered — `403` for anybody below `admin`.
   */
  async list(client: ApiClient = api()): Promise<WebhookList> {
    return unwrap(await client.GET("/api/v1/settings/webhooks", {}));
  },

  /**
   * Create an endpoint. **The answer is the only time its signing secret is returned.**
   *
   * @param body The endpoint.
   * @param client The client to call through.
   * @returns The endpoint and its secret.
   * @throws {ApiError} `422` with `details.fields` for a body or URL the service refuses.
   */
  async create(body: CreateWebhookRequest, client: ApiClient = api()): Promise<WebhookSecret> {
    return unwrap(await client.POST("/api/v1/settings/webhooks", { body }));
  },

  /**
   * Edit, enable or disable an endpoint.
   *
   * @param id The endpoint.
   * @param body Only what changed.
   * @param client The client to call through.
   * @returns The endpoint as stored.
   * @throws {ApiError} What the service answered.
   */
  async update(
    id: string,
    body: UpdateWebhookRequest,
    client: ApiClient = api(),
  ): Promise<WebhookEndpoint> {
    return unwrap(
      await client.PATCH("/api/v1/settings/webhooks/{id}", { params: { path: { id } }, body }),
    );
  },

  /**
   * Delete an endpoint and its delivery log.
   *
   * @param id The endpoint.
   * @param client The client to call through.
   * @throws {ApiError} What the service answered.
   */
  async remove(id: string, client: ApiClient = api()): Promise<void> {
    const result = await client.DELETE("/api/v1/settings/webhooks/{id}", {
      params: { path: { id } },
    });
    if (result.error !== undefined) unwrap(result);
  },

  /**
   * Replace an endpoint's signing secret. The old one signs nothing from this moment.
   *
   * @param id The endpoint.
   * @param client The client to call through.
   * @returns The endpoint and its new secret — shown once.
   * @throws {ApiError} What the service answered.
   */
  async rotateSecret(id: string, client: ApiClient = api()): Promise<WebhookSecret> {
    return unwrap(
      await client.POST("/api/v1/settings/webhooks/{id}/rotate-secret", {
        params: { path: { id } },
      }),
    );
  },

  /**
   * Send the `ping` event now, and answer with the delivery-log row it produced.
   *
   * @param id The endpoint.
   * @param client The client to call through.
   * @returns The attempt — succeeded or failed.
   * @throws {ApiError} What the service answered.
   */
  async ping(id: string, client: ApiClient = api()): Promise<WebhookDelivery> {
    return unwrap(
      await client.POST("/api/v1/settings/webhooks/{id}/ping", { params: { path: { id } } }),
    );
  },

  /**
   * One page of an endpoint's delivery log, newest first.
   *
   * @param id The endpoint.
   * @param query The status to narrow by, and the page.
   * @param client The client to call through.
   * @returns The page, with the total it is a page of.
   * @throws {ApiError} What the service answered.
   */
  async deliveries(
    id: string,
    query: DeliveryQuery = {},
    client: ApiClient = api(),
  ): Promise<WebhookDeliveryPage> {
    return unwrap(
      await client.GET("/api/v1/settings/webhooks/{id}/deliveries", {
        params: { path: { id }, query: { ...query } },
      }),
    );
  },

  /**
   * Queue a dead-lettered event again, with the same idempotency key.
   *
   * @param id The endpoint.
   * @param deliveryId The dead-lettered attempt.
   * @param client The client to call through.
   * @returns The new pending attempt.
   * @throws {ApiError} `409` for an attempt that is not the latest at its event, or not
   *   dead-lettered.
   */
  async redeliver(
    id: string,
    deliveryId: string,
    client: ApiClient = api(),
  ): Promise<WebhookDelivery> {
    return unwrap(
      await client.POST("/api/v1/settings/webhooks/{id}/deliveries/{deliveryId}/redeliver", {
        params: { path: { id, deliveryId } },
      }),
    );
  },
};
