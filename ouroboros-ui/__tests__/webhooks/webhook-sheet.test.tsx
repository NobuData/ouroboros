import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WebhookList } from "@/app/api/settings-webhooks";
import {
  ENDPOINTS_EMPTY_TITLE,
  ENDPOINTS_LOADING,
  SECRET_MASK,
  SECRET_TITLE,
  SECRET_WARNING,
  SHEET_TITLE,
} from "@/app/webhooks/view";

import { PALETTES, maskIds, renderInPalette } from "../helpers/palettes";
import {
  DEPLOY_ID,
  SECRET,
  SIEM_ID,
  deliveryPage,
  deployEndpoint,
  webhookDelivery,
  webhookEndpoint,
  webhookHealth,
  webhookList,
} from "../helpers/webhooks";

/**
 * The Webhooks management sheet, rendered (BS.5, #495): it creates an endpoint and shows its
 * secret once, fires a test ping whose result is visible, pauses, edits, rotates and deletes —
 * the destructive ones behind a stated consequence — and opens each endpoint's delivery log.
 */

const actions = {
  readWebhooks: vi.fn(),
  createWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  rotateWebhookSecret: vi.fn(),
  pingWebhook: vi.fn(),
  readDeliveries: vi.fn(),
  redeliverDelivery: vi.fn(),
};

vi.mock("@/app/webhooks/webhook-actions", () => ({
  readWebhooks: () => actions.readWebhooks() as unknown,
  createWebhook: (...args: unknown[]) => actions.createWebhook(...args) as unknown,
  updateWebhook: (...args: unknown[]) => actions.updateWebhook(...args) as unknown,
  deleteWebhook: (...args: unknown[]) => actions.deleteWebhook(...args) as unknown,
  rotateWebhookSecret: (...args: unknown[]) => actions.rotateWebhookSecret(...args) as unknown,
  pingWebhook: (...args: unknown[]) => actions.pingWebhook(...args) as unknown,
  readDeliveries: (...args: unknown[]) => actions.readDeliveries(...args) as unknown,
  redeliverDelivery: (...args: unknown[]) => actions.redeliverDelivery(...args) as unknown,
}));

const { WebhookSheet } = await import("@/app/webhooks/webhook-sheet");

const onClose = vi.fn();

/** Let the calls in flight answer. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/**
 * Press a button and let what it started answer.
 *
 * @param name The button's accessible name.
 * @param within_ Where to look. Defaults to the document.
 */
async function press(name: string | RegExp, within_: HTMLElement = document.body): Promise<void> {
  fireEvent.click(within(within_).getByRole("button", { name }));
  await settle();
}

/** The sheet's panel. */
function sheet(): HTMLElement {
  return screen.getByRole("dialog", { name: SHEET_TITLE });
}

/**
 * Mount the sheet, open.
 *
 * @param initial The page's read.
 */
async function mount(initial: WebhookList | null = webhookList()): Promise<void> {
  render(<WebhookSheet initial={initial} onClose={onClose} open />);
  await settle();
}

beforeEach(() => {
  onClose.mockReset();
  for (const call of Object.values(actions)) call.mockReset();
  actions.readWebhooks.mockResolvedValue({ ok: true, value: webhookList() });
  actions.readDeliveries.mockResolvedValue({ ok: true, value: deliveryPage() });
});

describe("the list", () => {
  it("draws nothing while closed", () => {
    render(<WebhookSheet initial={webhookList()} onClose={onClose} open={false} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("draws each endpoint's host, families, state and health — and never a secret", async () => {
    await mount(
      webhookList({
        items: [
          webhookEndpoint(),
          deployEndpoint({ active: false, health: webhookHealth({ state: "dead_lettered", deadLettered: 2 }) }),
        ],
        activeCount: 1,
      }),
    );

    const [siem, deploy] = within(sheet()).getAllByRole("listitem");

    expect(within(sheet()).getByText("1 active")).toBeTruthy();
    expect(siem.textContent).toContain("siem-forwarder");
    expect(siem.textContent).toContain("SIEM");
    expect(siem.textContent).toContain("siem.acme.dev");
    expect(siem.textContent).toContain("audit.*");
    expect(siem.textContent).toContain("active");
    expect(siem.textContent).toContain("healthy");
    expect(siem.textContent).toContain(SECRET_MASK);
    expect(deploy.textContent).toContain("pr.*, run.merged");
    expect(deploy.textContent).toContain("paused");
    expect(deploy.textContent).toContain("dead-lettering · 2 events dead-lettered");
    expect(deploy.textContent).not.toContain("SIEM");
    // The page's read is used as it is: nothing is fetched to draw the list.
    expect(actions.readWebhooks).not.toHaveBeenCalled();
  });

  it("reads on open when the page could not, saying so until it answers", async () => {
    render(<WebhookSheet initial={null} onClose={onClose} open />);

    expect(within(sheet()).getByRole("status").textContent).toBe(ENDPOINTS_LOADING);
    await settle();

    expect(actions.readWebhooks).toHaveBeenCalledOnce();
    expect(within(sheet()).getAllByRole("listitem")).toHaveLength(2);
  });

  it("says why the endpoints could not be read", async () => {
    actions.readWebhooks.mockResolvedValue({ ok: false, reason: "Owners and admins only.", code: "forbidden" });
    await mount(null);

    expect(within(sheet()).getByRole("alert").textContent).toBe("Owners and admins only.");
    expect(within(sheet()).queryByRole("button", { name: "+ Add endpoint" })).toBeNull();
  });

  it("says a workspace with no endpoint has none", async () => {
    await mount(webhookList({ items: [], activeCount: 0, siem: null }));

    expect(within(sheet()).getByText(ENDPOINTS_EMPTY_TITLE)).toBeTruthy();
  });

  it("takes a newer read from the page", async () => {
    const { rerender } = render(<WebhookSheet initial={webhookList()} onClose={onClose} open />);

    rerender(
      <WebhookSheet initial={webhookList({ items: [webhookEndpoint()], activeCount: 1 })} onClose={onClose} open />,
    );

    expect(within(sheet()).getAllByRole("listitem")).toHaveLength(1);
  });

  it("draws the same markup in both palettes", () => {
    // The sheet is portalled, so the panel is compared rather than the container.
    const [light, dark] = PALETTES.map((palette) => {
      const { unmount } = renderInPalette(palette, <WebhookSheet initial={webhookList()} onClose={onClose} open />);
      const html = sheet().innerHTML;
      unmount();
      return html;
    });

    expect(light).toContain("siem-forwarder");
    expect(maskIds(light)).toBe(maskIds(dark));
  });
});

describe("creating an endpoint", () => {
  it("creates it, shows its secret once, and forgets it on close", async () => {
    const created = webhookEndpoint({ id: "new-1", name: "pager", host: "pager.acme.dev", siem: false, eventFamilies: ["run.*"] });
    actions.createWebhook.mockResolvedValue({ ok: true, value: { endpoint: created, secret: SECRET } });
    await mount();

    await press("+ Add endpoint");
    const form = within(sheet()).getByRole("form", { name: "Add endpoint" });

    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "pager" } });
    fireEvent.change(within(form).getByLabelText("URL"), { target: { value: "https://pager.acme.dev/h" } });
    fireEvent.click(within(form).getByLabelText("run.*"));
    await act(async () => {
      fireEvent.submit(form);
    });
    await settle();

    expect(actions.createWebhook).toHaveBeenCalledExactlyOnceWith({
      name: "pager",
      url: "https://pager.acme.dev/h",
      eventFamilies: ["run.*"],
      siem: false,
    });

    const dialog = screen.getByRole("alertdialog", { name: SECRET_TITLE });
    expect(dialog.textContent).toContain(SECRET);
    expect(dialog.textContent).toContain(SECRET_WARNING);

    // The list is right at once, then confirmed by a re-read.
    expect(within(sheet()).getByText("pager was created.")).toBeTruthy();
    expect(within(sheet()).queryByRole("form")).toBeNull();
    expect(actions.readWebhooks).toHaveBeenCalledOnce();

    await press("I have copied it", dialog);

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("keeps a refused create in the form, and creates nothing", async () => {
    actions.createWebhook.mockResolvedValue({
      ok: false,
      reason: "Another endpoint is already the SIEM route.",
      code: "conflict",
      fields: { siem: "already taken by siem-forwarder" },
    });
    await mount();

    await press("+ Add endpoint");
    const form = within(sheet()).getByRole("form");

    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "second" } });
    fireEvent.change(within(form).getByLabelText("URL"), { target: { value: "https://second.acme.dev" } });
    fireEvent.click(within(form).getByLabelText("audit.*"));
    fireEvent.click(within(form).getByLabelText("Use as the SIEM stream"));
    await act(async () => {
      fireEvent.submit(form);
    });
    await settle();

    expect(within(sheet()).getByRole("form")).toBeTruthy();
    expect(within(sheet()).getByText("Another endpoint is already the SIEM route.")).toBeTruthy();
    expect(within(sheet()).getByText("already taken by siem-forwarder")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(within(sheet()).getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("the test ping", () => {
  it("shows the delivery row it produced under the endpoint", async () => {
    actions.pingWebhook.mockResolvedValue({ ok: true, value: webhookDelivery({ eventType: "ping" }) });
    await mount();

    await press("Test ping deploy-bot");

    expect(actions.pingWebhook).toHaveBeenCalledExactlyOnceWith(DEPLOY_ID);

    const [siem, deploy] = within(sheet()).getAllByRole("listitem");
    const result = within(deploy).getByRole("status");

    expect(result.textContent).toBe("Ping succeeded · HTTP 200 · 182 ms");
    expect(result.className).not.toContain("--failed");
    expect(within(siem).queryByRole("status")).toBeNull();
  });

  it("shows a failed ping as visibly as a successful one", async () => {
    actions.pingWebhook.mockResolvedValue({
      ok: true,
      value: webhookDelivery({ eventType: "ping", status: "failed", responseCode: 500, latencyMs: 40, error: "receiver answered 500" }),
    });
    await mount();

    await press("Test ping siem-forwarder");

    const result = within(within(sheet()).getAllByRole("listitem")[0]).getByRole("status");

    expect(result.textContent).toBe("Ping failed · HTTP 500 · 40 ms · receiver answered 500");
    expect(result.className).toContain("webhooks-endpoint__ping--failed");
  });

  it("shows why a ping could not be sent", async () => {
    actions.pingWebhook.mockResolvedValue({ ok: false, reason: "No such endpoint.", code: "not_found" });
    await mount();

    await press("Test ping siem-forwarder");

    expect(within(within(sheet()).getAllByRole("listitem")[0]).getByRole("status").textContent).toBe("No such endpoint.");
  });
});

describe("pausing, editing, rotating and deleting", () => {
  it("pauses an endpoint and recounts the active ones", async () => {
    actions.updateWebhook.mockResolvedValue({ ok: true, value: deployEndpoint({ active: false }) });
    actions.readWebhooks.mockResolvedValue({
      ok: true,
      value: webhookList({ items: [webhookEndpoint(), deployEndpoint({ active: false })], activeCount: 1 }),
    });
    await mount();

    fireEvent.click(within(sheet()).getByRole("switch", { name: "Pause deploy-bot" }));
    await settle();

    expect(actions.updateWebhook).toHaveBeenCalledExactlyOnceWith(DEPLOY_ID, { active: false });
    expect(within(sheet()).getByText("1 active")).toBeTruthy();
    expect(within(sheet()).getByRole("switch", { name: "Enable deploy-bot" })).toBeTruthy();
    expect(within(sheet()).getByText(/deploy-bot is paused/)).toBeTruthy();
  });

  it("says a refused switch as an alert and leaves the endpoint as it was", async () => {
    actions.updateWebhook.mockResolvedValue({ ok: false, reason: "Not now.", code: "conflict" });
    await mount();

    fireEvent.click(within(sheet()).getByRole("switch", { name: "Pause deploy-bot" }));
    await settle();

    expect(within(sheet()).getByRole("alert").textContent).toBe("Not now.");
    expect(within(sheet()).getByRole("switch", { name: "Pause deploy-bot" })).toBeTruthy();
  });

  it("edits with only what changed", async () => {
    actions.updateWebhook.mockResolvedValue({ ok: true, value: deployEndpoint({ name: "deployer" }) });
    await mount();

    await press("Edit deploy-bot");
    const form = within(sheet()).getByRole("form", { name: "Edit deploy-bot" });

    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "deployer" } });
    await act(async () => {
      fireEvent.submit(form);
    });
    await settle();

    expect(actions.updateWebhook).toHaveBeenCalledExactlyOnceWith(DEPLOY_ID, { name: "deployer" });
    expect(within(sheet()).getByText("deployer was saved.")).toBeTruthy();
    expect(within(sheet()).queryByRole("form")).toBeNull();
  });

  it("sends nothing for an edit that changed nothing", async () => {
    await mount();

    await press("Edit deploy-bot");
    await act(async () => {
      fireEvent.submit(within(sheet()).getByRole("form"));
    });
    await settle();

    expect(actions.updateWebhook).not.toHaveBeenCalled();
    expect(within(sheet()).queryByRole("form")).toBeNull();
  });

  it("rotates a secret only after the consequence is confirmed, and shows the new one once", async () => {
    actions.rotateWebhookSecret.mockResolvedValue({ ok: true, value: { endpoint: webhookEndpoint(), secret: SECRET } });
    await mount();

    await press("Rotate secret siem-forwarder", sheet());

    const confirm = screen.getByRole("alertdialog", { name: "Rotate secret siem-forwarder" });
    expect(confirm.textContent).toContain("stops signing at once");
    expect(actions.rotateWebhookSecret).not.toHaveBeenCalled();

    await press("Rotate secret", confirm);

    expect(actions.rotateWebhookSecret).toHaveBeenCalledExactlyOnceWith(SIEM_ID);

    const shown = screen.getByRole("alertdialog", { name: SECRET_TITLE });
    expect(shown.textContent).toContain(SECRET);
    expect(shown.textContent).toContain("The old one signs nothing");

    await press("I have copied it", shown);
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("deletes only after the consequence is confirmed, naming the SIEM stream", async () => {
    actions.deleteWebhook.mockResolvedValue({ ok: true, value: null });
    actions.readWebhooks.mockResolvedValue({
      ok: true,
      value: webhookList({ items: [deployEndpoint()], activeCount: 1, siem: null }),
    });
    await mount();

    await press("Delete siem-forwarder", sheet());

    const confirm = screen.getByRole("alertdialog", { name: "Delete siem-forwarder" });
    expect(confirm.textContent).toContain("audit events stop reaching the SIEM");

    await press("Cancel", confirm);
    expect(actions.deleteWebhook).not.toHaveBeenCalled();
    expect(within(sheet()).getAllByRole("listitem")).toHaveLength(2);

    await press("Delete siem-forwarder", sheet());
    await press("Delete endpoint", screen.getByRole("alertdialog"));

    expect(actions.deleteWebhook).toHaveBeenCalledExactlyOnceWith(SIEM_ID);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(within(sheet()).getAllByRole("listitem")).toHaveLength(1);
    expect(within(sheet()).getByText("siem-forwarder and its delivery log were deleted.")).toBeTruthy();
  });

  it("keeps a refused delete in the confirmation", async () => {
    actions.deleteWebhook.mockResolvedValue({ ok: false, reason: "No such endpoint.", code: "not_found" });
    await mount();

    await press("Delete deploy-bot", sheet());
    await press("Delete endpoint", screen.getByRole("alertdialog"));

    expect(within(screen.getByRole("alertdialog")).getByRole("alert").textContent).toBe("No such endpoint.");
    expect(within(sheet()).getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("an endpoint's delivery log", () => {
  it("opens under the endpoint, read when opened, and closes again", async () => {
    await mount();

    expect(actions.readDeliveries).not.toHaveBeenCalled();

    await press("Deliveries deploy-bot");

    expect(actions.readDeliveries).toHaveBeenCalledExactlyOnceWith(DEPLOY_ID, { limit: 25, offset: 0 });
    expect(within(sheet()).getByRole("table", { name: "Deliveries · deploy-bot" })).toBeTruthy();

    await press("Hide deliveries deploy-bot");

    expect(within(sheet()).queryByRole("table")).toBeNull();
  });
});

describe("closing", () => {
  it("asks the caller on Escape", async () => {
    await mount();

    fireEvent.keyDown(sheet(), { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
