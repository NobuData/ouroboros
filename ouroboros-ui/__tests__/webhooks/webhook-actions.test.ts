import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { DELIVERIES_FAILED, READ_FAILED, WRITE_FAILED } from "@/app/webhooks/view";

import { SECRET, SIEM_ID, deliveryPage, webhookDelivery, webhookEndpoint, webhookList } from "../helpers/webhooks";

/**
 * The webhook Server Actions (BS.5, #495): a refusal is a value with the service's sentence and
 * its fields, anything else keeps travelling, and a landed write re-reads the page.
 */

const refresh = vi.fn();
const api = {
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  rotateSecret: vi.fn(),
  ping: vi.fn(),
  deliveries: vi.fn(),
  redeliver: vi.fn(),
};

vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("@/app/api/settings-webhooks", () => ({ settingsWebhooks: api }));

const actions = await import("@/app/webhooks/webhook-actions");

beforeEach(() => {
  refresh.mockReset();
  for (const call of Object.values(api)) call.mockReset();
});

describe("the reads", () => {
  it("answer the list and a log page, and re-read nothing", async () => {
    api.list.mockResolvedValue(webhookList());
    api.deliveries.mockResolvedValue(deliveryPage());

    expect(await actions.readWebhooks()).toEqual({ ok: true, value: webhookList() });
    expect(await actions.readDeliveries(SIEM_ID, { status: "dead_lettered", limit: 25, offset: 0 })).toEqual({
      ok: true,
      value: deliveryPage(),
    });
    expect(api.deliveries).toHaveBeenCalledExactlyOnceWith(SIEM_ID, { status: "dead_lettered", limit: 25, offset: 0 });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keep a refusal as a sentence, with their own fallbacks", async () => {
    api.list.mockRejectedValue(new ApiError(403, "forbidden", ""));
    api.deliveries.mockRejectedValue(new ApiError(503, "unavailable", " "));

    expect(await actions.readWebhooks()).toEqual({ ok: false, reason: READ_FAILED, code: "forbidden" });
    expect(await actions.readDeliveries(SIEM_ID, {})).toEqual({ ok: false, reason: DELIVERIES_FAILED, code: "unavailable" });
  });
});

describe("the writes", () => {
  it("create, and re-read the page", async () => {
    const answer = { endpoint: webhookEndpoint(), secret: SECRET };
    api.create.mockResolvedValue(answer);
    const body = { name: "n", url: "https://x.dev", eventFamilies: ["audit.*"] };

    expect(await actions.createWebhook(body)).toEqual({ ok: true, value: answer });
    expect(api.create).toHaveBeenCalledExactlyOnceWith(body);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("route a refused create's fields, and re-read nothing", async () => {
    api.create.mockRejectedValue(
      new ApiError(422, "validation_failed", "The URL is not allowed.", {
        fields: { url: ["resolves to an internal address"] },
      }),
    );

    expect(await actions.createWebhook({ name: "n", url: "https://10.0.0.1", eventFamilies: ["audit.*"] })).toEqual({
      ok: false,
      reason: "The URL is not allowed.",
      code: "validation_failed",
      fields: { url: "resolves to an internal address" },
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("update, delete, rotate and redeliver, each re-reading the page", async () => {
    api.update.mockResolvedValue(webhookEndpoint({ active: false }));
    api.remove.mockResolvedValue(undefined);
    api.rotateSecret.mockResolvedValue({ endpoint: webhookEndpoint(), secret: SECRET });
    api.redeliver.mockResolvedValue(webhookDelivery({ status: "pending" }));

    expect((await actions.updateWebhook(SIEM_ID, { active: false })).ok).toBe(true);
    expect(await actions.deleteWebhook(SIEM_ID)).toEqual({ ok: true, value: null });
    expect(await actions.rotateWebhookSecret(SIEM_ID)).toMatchObject({ ok: true, value: { secret: SECRET } });
    expect((await actions.redeliverDelivery(SIEM_ID, "d-1")).ok).toBe(true);

    expect(api.update).toHaveBeenCalledExactlyOnceWith(SIEM_ID, { active: false });
    expect(api.remove).toHaveBeenCalledExactlyOnceWith(SIEM_ID);
    expect(api.redeliver).toHaveBeenCalledExactlyOnceWith(SIEM_ID, "d-1");
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it("keep a refused write as the service's sentence, or the fallback", async () => {
    api.remove.mockRejectedValue(new ApiError(404, "not_found", "No such endpoint."));
    api.redeliver.mockRejectedValue(new ApiError(409, "not_redeliverable", ""));

    expect(await actions.deleteWebhook(SIEM_ID)).toEqual({ ok: false, reason: "No such endpoint.", code: "not_found" });
    expect(await actions.redeliverDelivery(SIEM_ID, "d-1")).toEqual({ ok: false, reason: WRITE_FAILED, code: "not_redeliverable" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("ping answers the row it produced without re-reading the page — a ping changes no health", async () => {
    const row = webhookDelivery({ eventType: "ping", status: "failed" });
    api.ping.mockResolvedValue(row);

    expect(await actions.pingWebhook(SIEM_ID)).toEqual({ ok: true, value: row });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("let anything that is not the service refusing keep travelling", async () => {
    api.update.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(actions.updateWebhook(SIEM_ID, { active: true })).rejects.toThrow("NEXT_REDIRECT");
  });
});
