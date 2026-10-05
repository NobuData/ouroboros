import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { clientAnswering, stubClient } from "../helpers/api";
import {
  SECRET,
  SIEM_ID,
  deadLetter,
  deliveryPage,
  webhookDelivery,
  webhookEndpoint,
  webhookList,
} from "../helpers/webhooks";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { settingsWebhooks } = await import("@/app/api/settings-webhooks");

/**
 * The webhook endpoints' operations (#495 over #487): each reads or writes its own resource
 * under `/api/v1/settings/webhooks`, sending exactly the body it was given.
 */

/**
 * The method, path and query of the one request a call made.
 *
 * @param requests The requests the stub saw.
 * @returns `METHOD /path?query`.
 */
function sent(requests: Request[]): string {
  expect(requests).toHaveLength(1);
  const url = new URL(requests[0].url);

  return `${requests[0].method} ${url.pathname}${url.search}`;
}

const DELIVERY_ID = deadLetter().id;

describe("settingsWebhooks", () => {
  it("lists the endpoints", async () => {
    const { client, requests } = clientAnswering(webhookList());

    expect(await settingsWebhooks.list(client)).toEqual(webhookList());
    expect(sent(requests)).toBe("GET /api/v1/settings/webhooks");
  });

  it("creates an endpoint with exactly the body it was given, and answers the secret", async () => {
    const answer = { endpoint: webhookEndpoint(), secret: SECRET };
    const { client, requests } = clientAnswering(answer, 201);
    const body = { name: "siem-forwarder", url: "https://siem.acme.dev/h", eventFamilies: ["audit.*"], siem: true };

    expect(await settingsWebhooks.create(body, client)).toEqual(answer);
    expect(sent(requests)).toBe("POST /api/v1/settings/webhooks");
    expect(await requests[0].json()).toEqual(body);
  });

  it("patches one endpoint, sending only what changed", async () => {
    const { client, requests } = clientAnswering(webhookEndpoint({ active: false }));

    expect((await settingsWebhooks.update(SIEM_ID, { active: false }, client)).active).toBe(false);
    expect(sent(requests)).toBe(`PATCH /api/v1/settings/webhooks/${SIEM_ID}`);
    expect(await requests[0].json()).toEqual({ active: false });
  });

  it("deletes one endpoint", async () => {
    const { client, requests } = stubClient(() => ({ body: undefined, status: 204 }));

    await expect(settingsWebhooks.remove(SIEM_ID, client)).resolves.toBeUndefined();
    expect(sent(requests)).toBe(`DELETE /api/v1/settings/webhooks/${SIEM_ID}`);
  });

  it("throws the service's refusal of a delete", async () => {
    const { client } = clientAnswering({ code: "not_found", message: "No such endpoint.", details: {} }, 404);

    await expect(settingsWebhooks.remove(SIEM_ID, client)).rejects.toBeInstanceOf(ApiError);
  });

  it("rotates a secret", async () => {
    const answer = { endpoint: webhookEndpoint(), secret: SECRET };
    const { client, requests } = clientAnswering(answer);

    expect(await settingsWebhooks.rotateSecret(SIEM_ID, client)).toEqual(answer);
    expect(sent(requests)).toBe(`POST /api/v1/settings/webhooks/${SIEM_ID}/rotate-secret`);
  });

  it("sends a test ping and answers the row it produced", async () => {
    const row = webhookDelivery({ eventType: "ping" });
    const { client, requests } = clientAnswering(row);

    expect(await settingsWebhooks.ping(SIEM_ID, client)).toEqual(row);
    expect(sent(requests)).toBe(`POST /api/v1/settings/webhooks/${SIEM_ID}/ping`);
  });

  it("pages the delivery log, sending only the query it was given", async () => {
    const { client, requests } = clientAnswering(deliveryPage());

    expect(await settingsWebhooks.deliveries(SIEM_ID, {}, client)).toEqual(deliveryPage());
    expect(sent(requests)).toBe(`GET /api/v1/settings/webhooks/${SIEM_ID}/deliveries`);
  });

  it("narrows the delivery log to the dead-letter queue", async () => {
    const { client, requests } = clientAnswering(deliveryPage([deadLetter()]));

    await settingsWebhooks.deliveries(SIEM_ID, { status: "dead_lettered", limit: 25, offset: 50 }, client);

    expect(sent(requests)).toBe(
      `GET /api/v1/settings/webhooks/${SIEM_ID}/deliveries?status=dead_lettered&limit=25&offset=50`,
    );
  });

  it("redelivers a dead-lettered attempt", async () => {
    const row = webhookDelivery({ status: "pending", attempt: 7 });
    const { client, requests } = clientAnswering(row);

    expect(await settingsWebhooks.redeliver(SIEM_ID, DELIVERY_ID, client)).toEqual(row);
    expect(sent(requests)).toBe(
      `POST /api/v1/settings/webhooks/${SIEM_ID}/deliveries/${DELIVERY_ID}/redeliver`,
    );
  });
});
