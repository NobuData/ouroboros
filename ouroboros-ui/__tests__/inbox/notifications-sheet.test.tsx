import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { preferences } from "../helpers/inbox";
import { settle } from "../helpers/settle";

/**
 * *Notification settings* (BO.1, #466): the minimal preferences sheet over BN.3's contract —
 * digest on/off and its UTC time, instant mail, per-kind mutes — read when it opens and saved
 * together.
 */

const readNotificationSettings = vi.fn();
const updateNotificationSettings = vi.fn();

vi.mock("@/app/inbox/inbox-actions", () => ({
  snoozeAll: vi.fn(),
  readNotificationSettings: () => readNotificationSettings(),
  updateNotificationSettings: (patch: unknown) => updateNotificationSettings(patch),
}));

const { NotificationsAction } = await import("@/app/inbox/notifications-sheet");

/** Open the sheet and wait for it. */
async function open(): Promise<HTMLElement> {
  render(<NotificationsAction />);
  fireEvent.click(screen.getByRole("button", { name: "Notification settings" }));
  await settle();

  return screen.findByRole("dialog", { name: "Notification settings" });
}

beforeEach(() => {
  readNotificationSettings.mockReset().mockResolvedValue({ ok: true, value: preferences() });
  updateNotificationSettings.mockReset();
});

describe("the preferences sheet", () => {
  it("reads only when opened", async () => {
    render(<NotificationsAction />);

    expect(readNotificationSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Notification settings" }));
    await settle();

    expect(readNotificationSettings).toHaveBeenCalledOnce();
  });

  it("saves the whole draft and shows what the service answered", async () => {
    updateNotificationSettings.mockResolvedValue({
      ok: true,
      value: preferences({
        digest: { enabled: true, time: "08:15", timeZone: "UTC", nextSendAt: "2026-10-05T08:15:00.000Z" },
        instant: { severity: "off" },
        mutedKinds: ["fact_review"],
        isExplicit: true,
        updatedAt: "2026-10-04T13:20:00.000Z",
      }),
    });
    const sheet = await open();

    fireEvent.click(within(sheet).getByRole("switch", { name: "Daily digest" }));
    fireEvent.change(within(sheet).getByLabelText("Send at (UTC)"), { target: { value: "08:15" } });
    fireEvent.click(within(sheet).getByRole("switch", { name: "Instant mail for blocking decisions" }));
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Fact reviews" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await settle();

    expect(updateNotificationSettings).toHaveBeenCalledExactlyOnceWith({
      digestEnabled: true,
      digestTime: "08:15",
      instantSeverity: "off",
      mutedKinds: ["fact_review"],
    });
    await waitFor(() => expect(within(sheet).getByText("Saved.")).toBeInTheDocument());
    expect(within(sheet).getByText("Next digest 2026-10-05 08:15 UTC")).toBeInTheDocument();
  });

  it("refuses to save a time that is not HH:MM, saying how", async () => {
    const sheet = await open();

    fireEvent.change(within(sheet).getByLabelText("Send at (UTC)"), { target: { value: "9am" } });

    const save = within(sheet).getByRole("button", { name: "Save" });

    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(within(sheet).getByText("Use a time like 09:00 (UTC).")).toBeInTheDocument();
    fireEvent.click(save);
    expect(updateNotificationSettings).not.toHaveBeenCalled();
  });

  it("shows the service's refusal and keeps the draft", async () => {
    updateNotificationSettings.mockResolvedValue({ ok: false, reason: "No decision kind is declared as x." });
    const sheet = await open();

    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await settle();

    expect(within(sheet).getByRole("alert")).toHaveTextContent("No decision kind is declared as x.");
  });

  it("says so when the settings could not be read", async () => {
    readNotificationSettings.mockResolvedValue({ ok: false, reason: "down" });
    const sheet = await open();

    expect(within(sheet).getByRole("alert")).toHaveTextContent("Your notification settings could not be read.");
    expect(within(sheet).queryByRole("button", { name: "Save" })).toBeNull();
  });
});
