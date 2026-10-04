/**
 * What the webhook routes answer with (BR.3, [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * **No resource has a field for the secret except {@link WebhookSecretResource}**, which only the
 * create and rotate answers return. Every other shape is built from {@link EndpointRow}, which
 * leaves the envelope out at the `select`.
 *
 * **Counted, never stored.** `activeCount` (*Webhooks · 2 active*) counts active rows, and the
 * SIEM row's state is derived from its endpoint's delivery log — {@link endpointHealth}.
 */

import type { WebhookDeliveryStatus } from "../db/schema";
import type { DeliveryLogRow, EndpointHealthRow, EndpointRow } from "./webhooks.repository";
import { LATEST_REGISTRY_VERSION, WEBHOOK_FAMILIES, registeredTypes } from "./webhook.registry";
import { hostOf } from "./webhook.ssrf";

/**
 * An endpoint's delivery health.
 *
 * - `idle` — nothing delivered yet.
 * - `healthy` — the newest attempt succeeded and nothing is dead-lettered.
 * - `retrying` — the newest attempt failed and a retry is queued.
 * - `dead_lettered` — at least one event exhausted its attempts and waits in the DLQ.
 */
export type WebhookHealthState = "idle" | "healthy" | "retrying" | "dead_lettered";

/** An endpoint's health, as the management sheet and the SIEM row read it. */
export interface WebhookHealthResource {
  state: WebhookHealthState;
  /** Events in the DLQ — the warning's count. */
  deadLettered: number;
  /** Retries queued. */
  retrying: number;
  /** The newest settled attempt (pings excluded). */
  lastAttemptAt: string | null;
  lastStatus: WebhookDeliveryStatus | null;
  lastResponseCode: number | null;
  /** The newest success (pings excluded). */
  lastSucceededAt: string | null;
}

/** An endpoint. Never its secret. */
export interface WebhookEndpointResource {
  id: string;
  name: string;
  description: string | null;
  url: string;
  /** The URL's host — what a list shows. */
  host: string;
  eventFamilies: string[];
  registryVersion: number;
  siem: boolean;
  active: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  health: WebhookHealthResource;
}

/** The create and rotate answer — the one place the secret appears, once. */
export interface WebhookSecretResource {
  endpoint: WebhookEndpointResource;
  /** `whsec_…` — shown now and never again. */
  secret: string;
}

/**
 * The Audit card's *Stream to SIEM* row, derived.
 *
 * `streaming` is the ✓: an active SIEM endpoint whose newest attempt succeeded and whose DLQ is
 * empty. `warning` is the card's warning state: events are dead-lettered — the SIEM's record has a
 * hole until they are redelivered.
 */
export interface WebhookSiemResource {
  endpointId: string;
  name: string;
  active: boolean;
  streaming: boolean;
  warning: boolean;
  health: WebhookHealthResource;
}

/** The event registry, for a subscription picker. */
export interface WebhookRegistryResource {
  latestVersion: number;
  families: string[];
  /** Every type registered at the latest version, sorted. */
  eventTypes: string[];
}

/** `GET /settings/webhooks`. */
export interface WebhookListResource {
  items: WebhookEndpointResource[];
  /** *Webhooks · N active* — counted. */
  activeCount: number;
  /** The SIEM route, or `null` when the workspace has none. */
  siem: WebhookSiemResource | null;
  registry: WebhookRegistryResource;
}

/** One delivery attempt. */
export interface WebhookDeliveryResource {
  id: string;
  endpointId: string;
  /** `X-Ouro-Delivery` — the same on every attempt at one event. */
  deliveryKey: string;
  eventType: string;
  eventId: string | null;
  attempt: number;
  status: WebhookDeliveryStatus;
  responseCode: number | null;
  latencyMs: number | null;
  /** At most 1 024 characters of the receiver's answer, credentials redacted. */
  responseExcerpt: string | null;
  error: string | null;
  attemptedAt: string;
  nextAttemptAt: string | null;
  redeliverable: boolean;
}

/** A page of the delivery log, per the #31 convention. */
export interface WebhookDeliveryPageResource {
  items: WebhookDeliveryResource[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * An endpoint's health from its counted log.
 *
 * @param row - The counts, or `undefined` for an endpoint with no attempts.
 * @returns The derived health.
 */
export function endpointHealth(row: EndpointHealthRow | undefined): WebhookHealthResource {
  const deadLettered = row?.dead_lettered ?? 0;
  const retrying = row?.retrying ?? 0;
  const lastStatus = row?.last_status ?? null;

  let state: WebhookHealthState;

  if (deadLettered > 0) {
    state = "dead_lettered";
  } else if (lastStatus === null) {
    state = retrying > 0 ? "retrying" : "idle";
  } else if (lastStatus === "succeeded") {
    state = "healthy";
  } else {
    state = "retrying";
  }

  return {
    state,
    deadLettered,
    retrying,
    lastAttemptAt: row?.last_attempted_at?.toISOString() ?? null,
    lastStatus,
    lastResponseCode: row?.last_response_code ?? null,
    lastSucceededAt: row?.last_succeeded_at?.toISOString() ?? null,
  };
}

/**
 * An endpoint as the API returns it.
 *
 * @param row - The row (no envelope).
 * @param health - Its health.
 * @returns The resource.
 */
export function endpointResource(
  row: EndpointRow,
  health: WebhookHealthResource,
): WebhookEndpointResource {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    url: row.url,
    host: hostOf(new URL(row.url)),
    eventFamilies: [...row.event_families],
    registryVersion: row.registry_version,
    siem: row.siem,
    active: row.active,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    health,
  };
}

/**
 * The SIEM row from the workspace's endpoints.
 *
 * @param items - Every endpoint, rendered.
 * @returns The SIEM row, or `null`.
 */
export function siemResource(
  items: readonly WebhookEndpointResource[],
): WebhookSiemResource | null {
  const siem = items.find((item) => item.siem);

  if (siem === undefined) return null;

  return {
    endpointId: siem.id,
    name: siem.name,
    active: siem.active,
    streaming: siem.active && siem.health.state === "healthy",
    warning: siem.health.deadLettered > 0,
    health: siem.health,
  };
}

/**
 * The registry as the list answer carries it.
 *
 * @returns The latest version, the families and every type registered at it.
 */
export function registryResource(): WebhookRegistryResource {
  return {
    latestVersion: LATEST_REGISTRY_VERSION,
    families: WEBHOOK_FAMILIES.map((family) => `${family}.*`),
    eventTypes: [...registeredTypes(LATEST_REGISTRY_VERSION)].sort(),
  };
}

/**
 * One attempt as the API returns it.
 *
 * @param row - The log row.
 * @returns The resource.
 */
export function deliveryResource(row: DeliveryLogRow): WebhookDeliveryResource {
  return {
    id: row.id,
    endpointId: row.endpoint_id,
    deliveryKey: row.delivery_key,
    eventType: row.event_type,
    eventId: row.event_id,
    attempt: row.attempt,
    status: row.status,
    responseCode: row.response_code,
    latencyMs: row.latency_ms,
    responseExcerpt: row.response_excerpt,
    error: row.error,
    attemptedAt: row.attempted_at.toISOString(),
    nextAttemptAt: row.next_attempt_at?.toISOString() ?? null,
    redeliverable: row.redeliverable,
  };
}
