import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FAMILIES_REQUIRED,
  FORM_SECRET_NOTE,
  NAME_REQUIRED,
  SIEM_NEEDS_AUDIT,
  URL_NOT_HTTPS,
  URL_REQUIRED,
  type WebhookDraft,
  type WebhookWrite,
} from "@/app/webhooks/view";
import { WebhookForm } from "@/app/webhooks/webhook-form";

import { deployEndpoint, webhookList } from "../helpers/webhooks";

/**
 * The endpoint form (BS.5, #495): the browser's checks land on their fields before anything is
 * sent, and the service's refusal lands the same way.
 */

const onSubmit = vi.fn<(draft: WebhookDraft) => Promise<WebhookWrite<unknown>>>();
const onCancel = vi.fn();
const FAMILIES = webhookList().registry.families;

/** Submit the form and let the write answer. */
async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.submit(screen.getByRole("form"));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Type into a labelled field.
 *
 * @param label The field's label.
 * @param value What to type.
 */
function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  onSubmit.mockReset().mockResolvedValue({ ok: true, value: null });
  onCancel.mockReset();
});

describe("creating", () => {
  it("offers the registry's families, and says the secret comes after", () => {
    render(<WebhookForm endpoint={null} families={FAMILIES} onCancel={onCancel} onSubmit={onSubmit} />);

    expect(screen.getByRole("form", { name: "Add endpoint" })).toBeTruthy();
    for (const family of FAMILIES) expect(screen.getByLabelText(family)).toBeTruthy();
    expect(screen.getByText(FORM_SECRET_NOTE)).toBeTruthy();
    expect(screen.queryByLabelText(/secret/i)).toBeNull();
  });

  it("sends nothing while the browser can see what is wrong, and says it on each field", async () => {
    render(<WebhookForm endpoint={null} families={FAMILIES} onCancel={onCancel} onSubmit={onSubmit} />);

    await submit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(NAME_REQUIRED)).toBeTruthy();
    expect(screen.getByText(URL_REQUIRED)).toBeTruthy();
    expect(screen.getByText(FAMILIES_REQUIRED)).toBeTruthy();

    type("Name", "siem");
    expect(screen.queryByText(NAME_REQUIRED)).toBeNull();

    type("URL", "http://siem.acme.dev");
    fireEvent.click(screen.getByLabelText("pr.*"));
    fireEvent.click(screen.getByLabelText("Use as the SIEM stream"));
    await submit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(URL_NOT_HTTPS)).toBeTruthy();
    expect(screen.getByText(SIEM_NEEDS_AUDIT)).toBeTruthy();
  });

  it("sends the draft once it is whole", async () => {
    render(<WebhookForm endpoint={null} families={FAMILIES} onCancel={onCancel} onSubmit={onSubmit} />);

    type("Name", "siem-forwarder");
    type("URL", "https://siem.acme.dev/h");
    fireEvent.click(screen.getByLabelText("audit.*"));
    fireEvent.click(screen.getByLabelText("Use as the SIEM stream"));
    type("Description", "Splunk");
    await submit();

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      name: "siem-forwarder",
      url: "https://siem.acme.dev/h",
      description: "Splunk",
      families: ["audit.*"],
      siem: true,
    });
  });

  it("keeps a refusal in the form: its sentence, and its errors on the fields it named", async () => {
    onSubmit.mockResolvedValue({
      ok: false,
      reason: "The URL is not allowed.",
      code: "validation_failed",
      fields: { url: "resolves to an internal address" },
    });
    render(<WebhookForm endpoint={null} families={FAMILIES} onCancel={onCancel} onSubmit={onSubmit} />);

    type("Name", "n");
    type("URL", "https://internal.acme.dev");
    fireEvent.click(screen.getByLabelText("run.*"));
    await submit();

    expect(screen.getByText("The URL is not allowed.")).toBeTruthy();
    expect(screen.getByText("resolves to an internal address")).toBeTruthy();
    expect((screen.getByLabelText("URL") as HTMLInputElement).value).toBe("https://internal.acme.dev");
  });

  it("cancels without sending", () => {
    render(<WebhookForm endpoint={null} families={FAMILIES} onCancel={onCancel} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("editing", () => {
  it("starts from the endpoint, keeps an exact event type as a choice, and has no secret note", () => {
    render(<WebhookForm endpoint={deployEndpoint()} families={FAMILIES} onCancel={onCancel} onSubmit={onSubmit} />);

    expect(screen.getByRole("form", { name: "Edit deploy-bot" })).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("deploy-bot");
    expect((screen.getByLabelText("pr.*") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("run.merged") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("audit.*") as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText(FORM_SECRET_NOTE)).toBeNull();
    expect(screen.getByRole("button", { name: "Save endpoint" })).toBeTruthy();
  });
});
