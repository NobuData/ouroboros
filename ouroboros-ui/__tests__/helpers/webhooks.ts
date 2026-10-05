import type {
  WebhookDelivery,
  WebhookDeliveryPage,
  WebhookEndpoint,
  WebhookHealth,
  WebhookList,
} from "@/app/api/settings-webhooks";

/**
 * The webhook surfaces' fixtures (BS.5, #495) — mockup 17's *Webhooks · 2 active* and
 * *Stream to SIEM ✓*, as the service answers them: two active endpoints, one of them the SIEM
 * route subscribed to `audit.*` and healthy.
 */

/** The SIEM endpoint's id. */
export const SIEM_ID = "11111111-1111-4111-8111-111111111111";

/** The other endpoint's id. */
export const DEPLOY_ID = "22222222-2222-4222-8222-222222222222";

/** A signing secret, as create and rotate answer it. */
export const SECRET = "whsec_4f1c9a7d2b6e8035a1c4d7e9f2b5a8c3";

/**
 * A delivery health.
 *
 * @param overrides Fields to replace.
 * @returns A healthy endpoint's health.
 */
export function webhookHealth(overrides: Partial<WebhookHealth> = {}): WebhookHealth {
  return {
    state: "healthy",
    deadLettered: 0,
    retrying: 0,
    lastAttemptAt: "2026-10-05T14:31:07.000Z",
    lastStatus: "succeeded",
    lastResponseCode: 200,
    lastSucceededAt: "2026-10-05T14:31:07.000Z",
    ...overrides,
  };
}

/**
 * One endpoint — the SIEM route unless overridden.
 *
 * @param overrides Fields to replace.
 * @returns The endpoint.
 */
export function webhookEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: SIEM_ID,
    name: "siem-forwarder",
    description: "Splunk HEC",
    url: "https://siem.acme.dev/hooks/ouroboros",
    host: "siem.acme.dev",
    eventFamilies: ["audit.*"],
    registryVersion: 7,
    siem: true,
    active: true,
    createdBy: "Ken",
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: "2026-09-01T09:00:00.000Z",
    health: webhookHealth(),
    ...overrides,
  };
}

/** The second seeded endpoint: pull-request and run events to a deploy bot. */
export function deployEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return webhookEndpoint({
    id: DEPLOY_ID,
    name: "deploy-bot",
    description: null,
    url: "https://deploy.acme.dev/ouroboros",
    host: "deploy.acme.dev",
    eventFamilies: ["pr.*", "run.merged"],
    siem: false,
    ...overrides,
  });
}

/**
 * The endpoints as an owner reads them: two active, the SIEM stream healthy.
 *
 * @param overrides Fields to replace.
 * @returns The list.
 */
export function webhookList(overrides: Partial<WebhookList> = {}): WebhookList {
  return {
    items: [webhookEndpoint(), deployEndpoint()],
    activeCount: 2,
    siem: {
      endpointId: SIEM_ID,
      name: "siem-forwarder",
      active: true,
      streaming: true,
      warning: false,
      health: webhookHealth(),
    },
    registry: {
      latestVersion: 7,
      families: ["audit.*", "decision.*", "run.*", "pr.*"],
      eventTypes: ["audit.provider.rotated", "decision.created", "pr.opened", "run.merged"],
    },
    ...overrides,
  };
}

/**
 * The list with its SIEM row in another state.
 *
 * @param siem The SIEM row's fields to replace.
 * @returns The list.
 */
export function webhookListWithSiem(
  siem: Partial<NonNullable<WebhookList["siem"]>>,
): WebhookList {
  const list = webhookList();

  return { ...list, siem: { ...(list.siem as NonNullable<WebhookList["siem"]>), ...siem } };
}

/**
 * One delivery attempt — a succeeded audit event unless overridden.
 *
 * @param overrides Fields to replace.
 * @returns The attempt.
 */
export function webhookDelivery(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    endpointId: SIEM_ID,
    deliveryKey: "bbbbbbbb-0000-4000-8000-000000000001",
    eventType: "audit.provider.rotated",
    eventId: "cccccccc-0000-4000-8000-000000000001",
    attempt: 1,
    status: "succeeded",
    responseCode: 200,
    latencyMs: 182,
    responseExcerpt: "ok",
    error: null,
    attemptedAt: "2026-10-05T14:31:07.000Z",
    nextAttemptAt: null,
    redeliverable: false,
    ...overrides,
  };
}

/** A dead-lettered attempt the service will redeliver. */
export function deadLetter(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return webhookDelivery({
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    deliveryKey: "bbbbbbbb-0000-4000-8000-000000000002",
    eventType: "audit.policy.published",
    attempt: 6,
    status: "dead_lettered",
    responseCode: 503,
    latencyMs: 30012,
    responseExcerpt: null,
    error: "receiver answered 503",
    attemptedAt: "2026-10-05T13:02:44.000Z",
    redeliverable: true,
    ...overrides,
  });
}

/**
 * One page of a delivery log.
 *
 * @param items The page's attempts. Defaults to a success and a dead letter.
 * @param overrides `total`, `limit` or `offset` to replace.
 * @returns The page.
 */
export function deliveryPage(
  items: readonly WebhookDelivery[] = [webhookDelivery(), deadLetter()],
  overrides: Partial<Omit<WebhookDeliveryPage, "items">> = {},
): WebhookDeliveryPage {
  return { items: [...items], total: items.length, limit: 25, offset: 0, ...overrides };
}
