import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DeliveryQuery, WebhookDelivery, WebhookDeliveryPage } from "@/app/api/settings-webhooks";
import {
  DELIVERIES_EMPTY,
  DELIVERIES_LOADING,
  DLQ_EMPTY,
  type WebhookWrite,
} from "@/app/webhooks/view";

import { SIEM_ID, deadLetter, deliveryPage, webhookDelivery } from "../helpers/webhooks";

/**
 * The delivery log, rendered (BS.5, #495): real attempts with their codes and latencies, the
 * dead-letter queue, a pager that says how much there is, and Redeliver on the rows that may be.
 */

const readDeliveries = vi.fn<(id: string, query: DeliveryQuery) => Promise<WebhookWrite<WebhookDeliveryPage>>>();
const redeliverDelivery = vi.fn<(id: string, deliveryId: string) => Promise<WebhookWrite<WebhookDelivery>>>();

vi.mock("@/app/webhooks/webhook-actions", () => ({
  readDeliveries: (id: string, query: DeliveryQuery) => readDeliveries(id, query),
  redeliverDelivery: (id: string, deliveryId: string) => redeliverDelivery(id, deliveryId),
}));

const { DeliveryLog } = await import("@/app/webhooks/delivery-log");

/** Let the reads in flight answer. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Mount the SIEM endpoint's log and let its first read answer. */
async function mount(): Promise<void> {
  render(<DeliveryLog endpointId={SIEM_ID} endpointName="siem-forwarder" />);
  await settle();
}

beforeEach(() => {
  readDeliveries.mockReset().mockResolvedValue({ ok: true, value: deliveryPage() });
  redeliverDelivery.mockReset();
});

describe("the log", () => {
  it("says it is reading, then draws each attempt with its status, code and latency", async () => {
    render(<DeliveryLog endpointId={SIEM_ID} endpointName="siem-forwarder" />);

    expect(screen.getByRole("status").textContent).toBe(DELIVERIES_LOADING);
    await settle();

    expect(readDeliveries).toHaveBeenCalledExactlyOnceWith(SIEM_ID, { limit: 25, offset: 0 });

    const table = screen.getByRole("table", { name: "Deliveries · siem-forwarder" });
    const rows = within(table).getAllByRole("row").slice(1);

    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("2026-10-05 14:31:07");
    expect(rows[0].textContent).toContain("audit.provider.rotated");
    expect(rows[0].textContent).toContain("succeeded");
    expect(rows[0].textContent).toContain("200");
    expect(rows[0].textContent).toContain("182 ms");
    expect(rows[1].textContent).toContain("dead-lettered");
    expect(rows[1].textContent).toContain("503");
    expect(rows[1].textContent).toContain("receiver answered 503");
  });

  it("says which rows of how many, and pages older and newer", async () => {
    readDeliveries.mockResolvedValue({
      ok: true,
      value: deliveryPage([webhookDelivery()], { total: 60, offset: 0 }),
    });
    await mount();

    expect(screen.getByText("1–1 of 60")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Newer" }).getAttribute("aria-disabled")).toBe("true");

    readDeliveries.mockResolvedValue({
      ok: true,
      value: deliveryPage([webhookDelivery()], { total: 60, offset: 25 }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Older" }));
    await settle();

    expect(readDeliveries).toHaveBeenLastCalledWith(SIEM_ID, { limit: 25, offset: 25 });
    expect(screen.getByText("26–26 of 60")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Newer" }));
    await settle();

    expect(readDeliveries).toHaveBeenLastCalledWith(SIEM_ID, { limit: 25, offset: 0 });
  });

  it("makes Older inert on the last page", async () => {
    await mount();

    expect(screen.getByRole("button", { name: "Older" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("narrows to the dead-letter queue from the first page", async () => {
    await mount();

    readDeliveries.mockResolvedValue({ ok: true, value: deliveryPage([]) });
    fireEvent.click(screen.getByRole("button", { name: "Dead-lettered" }));
    await settle();

    expect(readDeliveries).toHaveBeenLastCalledWith(SIEM_ID, { limit: 25, offset: 0, status: "dead_lettered" });
    expect(screen.getByRole("button", { name: "Dead-lettered" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(DLQ_EMPTY)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says an empty log is empty", async () => {
    readDeliveries.mockResolvedValue({ ok: true, value: deliveryPage([]) });
    await mount();

    expect(screen.getByText(DELIVERIES_EMPTY)).toBeTruthy();
  });

  it("says why a log could not be read", async () => {
    readDeliveries.mockResolvedValue({ ok: false, reason: "Owners and admins only.", code: "forbidden" });
    await mount();

    expect(screen.getByRole("alert").textContent).toBe("Owners and admins only.");
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("redelivery", () => {
  it("is offered only on a row the service calls redeliverable", async () => {
    await mount();

    expect(screen.getAllByRole("button", { name: /^Redeliver / })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Redeliver audit.policy.published, attempt 6" })).toBeTruthy();
  });

  it("queues the event again, says so, and reads the page again", async () => {
    redeliverDelivery.mockResolvedValue({
      ok: true,
      value: webhookDelivery({ eventType: "audit.policy.published", attempt: 7, status: "pending" }),
    });
    await mount();

    fireEvent.click(screen.getByRole("button", { name: /^Redeliver / }));
    await settle();

    expect(redeliverDelivery).toHaveBeenCalledExactlyOnceWith(SIEM_ID, deadLetter().id);
    expect(screen.getByText(/queued again as attempt 7/)).toBeTruthy();
    expect(readDeliveries).toHaveBeenCalledTimes(2);
  });

  it("says the service's refusal as an alert", async () => {
    redeliverDelivery.mockResolvedValue({ ok: false, reason: "Only the latest attempt can be redelivered.", code: "conflict" });
    await mount();

    fireEvent.click(screen.getByRole("button", { name: /^Redeliver / }));
    await settle();

    expect(screen.getByRole("alert").textContent).toBe("Only the latest attempt can be redelivered.");
  });
});
