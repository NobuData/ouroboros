import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SHEET_TITLE } from "@/app/webhooks/view";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { SIEM_ID, deliveryPage, webhookHealth, webhookList, webhookListWithSiem } from "../helpers/webhooks";

/**
 * The Audit card's Stream to SIEM row (BS.5, #495): a ✓ only when deliveries are healthy, a
 * warning when they are dead-lettering, the truth in words otherwise — and the delivery log
 * behind it.
 */

const readDeliveries = vi.fn();
const readWebhooks = vi.fn();

vi.mock("@/app/webhooks/webhook-actions", () => ({
  readDeliveries: (...args: unknown[]) => readDeliveries(...args) as unknown,
  readWebhooks: () => readWebhooks() as unknown,
  redeliverDelivery: vi.fn(),
  createWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  rotateWebhookSecret: vi.fn(),
  pingWebhook: vi.fn(),
}));

const { SiemRow } = await import("@/app/webhooks/siem-row");

/** Let the reads in flight answer. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** The row's button. */
function row(): HTMLElement {
  return screen.getByRole("button", { name: /^Stream to SIEM\./ });
}

beforeEach(() => {
  readDeliveries.mockReset().mockResolvedValue({ ok: true, value: deliveryPage() });
  readWebhooks.mockReset().mockResolvedValue({ ok: true, value: webhookList({ items: [], activeCount: 0, siem: null }) });
});

describe("the status claim", () => {
  it("shows the ✓ when deliveries are healthy", () => {
    render(<SiemRow webhooks={webhookList()} />);

    expect(row().textContent).toBe("Stream to SIEM✓(webhook)");
    expect(row().getAttribute("aria-label")).toContain("being delivered");
  });

  it("shows a warning, with the count and no ✓, when events are dead-lettered", () => {
    render(
      <SiemRow
        webhooks={webhookListWithSiem({
          streaming: false,
          warning: true,
          health: webhookHealth({ state: "dead_lettered", deadLettered: 3 }),
        })}
      />,
    );

    expect(row().textContent).toBe("Stream to SIEM⚠— deliveries failing (3 events dead-lettered)");
    expect(row().textContent).not.toContain("✓");
    expect(row().className).toContain("webhooks-siem--warn");
  });

  it.each([
    [webhookListWithSiem({ streaming: false, active: false }), "paused"],
    [webhookListWithSiem({ streaming: false, health: webhookHealth({ state: "idle" }) }), "no deliveries yet"],
    [webhookList({ siem: null }), "not set up"],
    [null, "status unavailable"],
  ] as const)("never shows an unearned ✓: %#", (webhooks, words) => {
    render(<SiemRow webhooks={webhooks} />);

    expect(row().textContent).toContain(words);
    expect(row().textContent).not.toContain("✓");
  });

  it("draws the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<SiemRow webhooks={webhookList()} />);

    expect(maskIds(light)).toBe(maskIds(dark));
  });
});

describe("the evidence", () => {
  it("opens the SIEM endpoint's delivery log, read on every open", async () => {
    render(<SiemRow webhooks={webhookList()} />);

    expect(readDeliveries).not.toHaveBeenCalled();

    fireEvent.click(row());
    await settle();

    const sheet = screen.getByRole("dialog", { name: "Deliveries · siem-forwarder" });
    expect(sheet.textContent).toContain("audit.provider.rotated");
    expect(readDeliveries).toHaveBeenCalledExactlyOnceWith(SIEM_ID, { limit: 25, offset: 0 });

    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(row());
    await settle();

    expect(readDeliveries).toHaveBeenCalledTimes(2);
  });

  it("opens the webhook endpoints when no endpoint is the SIEM stream", async () => {
    render(<SiemRow webhooks={webhookList({ siem: null })} />);

    fireEvent.click(row());
    await settle();

    expect(screen.getByRole("dialog", { name: SHEET_TITLE })).toBeTruthy();
    expect(readDeliveries).not.toHaveBeenCalled();
  });

  it("reads the endpoints on open when the page could not", async () => {
    render(<SiemRow webhooks={null} />);

    fireEvent.click(row());
    await settle();

    expect(readWebhooks).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: SHEET_TITLE })).toBeTruthy();
  });
});
