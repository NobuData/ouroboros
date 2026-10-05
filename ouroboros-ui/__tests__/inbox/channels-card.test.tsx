import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxChannels, NotificationPreferences } from "@/app/api/inbox";
import type { Reading } from "@/app/api/reading";

import { digestOn, preferences, seededChannels } from "../helpers/inbox";
import { settle } from "../helpers/settle";

/**
 * **Answer From Anywhere** (BO.4, #469): the rows are BN.3's truth payload verbatim, a ✓ exists
 * only for a connected channel, and the only controls on the card are the ones that do something
 * — the email row's digest, and the way into the preferences sheet.
 */

const readNotificationSettings = vi.fn();
const updateNotificationSettings = vi.fn();

vi.mock("@/app/inbox/inbox-actions", () => ({
  snoozeAll: vi.fn(),
  readNotificationSettings: () => readNotificationSettings(),
  updateNotificationSettings: (patch: unknown) => updateNotificationSettings(patch),
}));

const { ChannelsCard } = await import("@/app/inbox/channels-card");

/** What the card's owner heard, in order. */
let heard: NotificationPreferences[] = [];

/**
 * The card as the screen mounts it: the preferences are held above it, and follow what it reports.
 */
function Harness({
  channels,
  failure = null,
  initial,
}: Readonly<{ channels: InboxChannels | null; failure?: string | null; initial: Reading<NotificationPreferences> }>) {
  const [held, setHeld] = useState(initial);

  return (
    <ChannelsCard
      channels={channels}
      failure={failure}
      onPreferences={(learned) => {
        heard.push(learned);
        setHeld({ ok: true, value: learned });
      }}
      preferences={held}
    />
  );
}

/** Render the card over a payload and the reader's preferences. */
function card(
  channels: InboxChannels | null = seededChannels(),
  initial: NotificationPreferences | null = preferences(),
  failure: string | null = null,
) {
  return render(
    <Harness
      channels={channels}
      failure={failure}
      initial={initial === null ? { ok: false, reason: "unread" } : { ok: true, value: initial }}
    />,
  );
}

/** The card's region. */
const region = () => screen.getByRole("region", { name: "Answer from anywhere" });

/** One channel's row, by its name. */
function row(name: string): HTMLElement {
  const found = within(region())
    .getAllByRole("listitem")
    .find((item) => item.querySelector(".inbox-channels__name")?.textContent === name);

  if (found === undefined) throw new Error(`no ${name} row`);

  return found;
}

/** The text at a row's edge. */
const mark = (name: string) => row(name).querySelector(".inbox-channels__mark")!;

beforeEach(() => {
  heard = [];
  readNotificationSettings.mockReset().mockResolvedValue({ ok: true, value: preferences() });
  updateNotificationSettings.mockReset();
});

describe("the rows", () => {
  it("are the truth payload's, in its order, in its words", () => {
    card();

    const items = within(region()).getAllByRole("listitem");

    expect(items.map((item) => item.querySelector(".inbox-channels__name")?.textContent)).toEqual([
      "Slack",
      "Email",
      "Mobile push",
      "GitHub",
    ]);
    expect(items.map((item) => item.querySelector(".inbox-channels__sub")?.textContent)).toEqual(
      seededChannels().channels.map((channel) => channel.summary),
    );
  });

  it("on a default self-hosted install: GitHub ✓, Email ✓, Slack arrives with Chat Ops, push arrives later", () => {
    card();

    expect(mark("GitHub")).toHaveTextContent("✓ connected");
    expect(mark("Email")).toHaveTextContent("✓ connected");
    expect(mark("Slack")).toHaveTextContent("not yet");
    expect(within(row("Slack")).getByText("Arrives with Chat Ops.")).toBeInTheDocument();
    expect(mark("Mobile push")).toHaveTextContent("not yet");
    expect(within(row("Mobile push")).getByText("Arrives later.")).toBeInTheDocument();
  });

  it("draws no ✓ beside a channel that is not connected — anywhere on the card", () => {
    card();

    const ticks = [...region().querySelectorAll("*")].filter(
      (element) => element.children.length === 0 && element.textContent.includes("✓"),
    );

    // Two connected channels, two ticks — and each is on a connected row.
    expect(ticks).toHaveLength(2);
    expect(row("Slack").textContent).not.toContain("✓");
    expect(row("Mobile push").textContent).not.toContain("✓");
    expect(mark("Slack")).not.toHaveClass("inbox-channels__mark--ok");
    expect(mark("GitHub")).toHaveClass("inbox-channels__mark--ok");
  });

  it("draws no ✓ at all on a deployment with nothing connected, and says what each is missing", () => {
    card(
      seededChannels({
        email: { state: "available", reason: "This deployment has no mail server: set OURO_SMTP_URL." },
        github: { state: "available", reason: "Connect a git host to mirror decisions on its pull requests." },
      }),
    );

    expect(region().textContent).not.toContain("✓");
    expect(mark("Email")).toHaveTextContent("not connected");
    expect(
      within(row("Email")).getByText("This deployment has no mail server: set OURO_SMTP_URL."),
    ).toBeInTheDocument();
    expect(mark("GitHub")).toHaveTextContent("not connected");
    expect(
      within(row("GitHub")).getByText("Connect a git host to mirror decisions on its pull requests."),
    ).toBeInTheDocument();
  });

  it("flips a row when the payload says the channel landed — with no change here", () => {
    const { rerender } = card();

    expect(mark("Slack")).toHaveTextContent("not yet");

    rerender(
      <Harness
        channels={seededChannels({
          slack: { state: "connected", until: null, reason: null },
          push: { state: "connected", until: null, reason: null },
        })}
        initial={{ ok: true, value: preferences() }}
      />,
    );

    expect(mark("Slack")).toHaveTextContent("✓ connected");
    expect(within(row("Slack")).queryByText("Arrives with Chat Ops.")).toBeNull();
    expect(mark("Mobile push")).toHaveTextContent("✓ connected");
    expect(within(row("Mobile push")).queryByText("Arrives later.")).toBeNull();
  });

  it("draws a channel this client has never heard of from its own words", () => {
    card({
      channels: [
        {
          id: "pager" as never,
          label: "Pager",
          summary: "Pages whoever is on call.",
          state: "available",
          until: null,
          reason: "Connect a paging service.",
        },
      ],
    });

    expect(mark("Pager")).toHaveTextContent("not connected");
    expect(within(row("Pager")).getByText("Pages whoever is on call.")).toBeInTheDocument();
  });

  it("keeps the mark on the name's line, and the channel's sentences out of it", () => {
    card();

    const head = row("Slack").querySelector(".inbox-channels__head")!;

    expect([...head.children].map((child) => child.className)).toEqual([
      "inbox-channels__name",
      "inbox-channels__mark",
    ]);
    expect(head).not.toContainElement(row("Slack").querySelector(".inbox-channels__sub"));
    expect(head).not.toContainElement(row("Slack").querySelector(".inbox-channels__reason"));
  });

  it("explains the GitHub comment's life: posted when asked, edited when answered", () => {
    card();

    expect(row("GitHub")).toHaveTextContent(
      "Every decision is mirrored as a PR comment — posted when it is asked, edited when it is answered.",
    );
  });
});

describe("the push row", () => {
  it("has no switch, no button and no field — nothing that would do nothing", () => {
    card();

    expect(within(row("Mobile push")).queryByRole("switch")).toBeNull();
    expect(within(row("Mobile push")).queryByRole("button")).toBeNull();
    expect(within(row("Mobile push")).queryByRole("textbox")).toBeNull();
    expect(within(row("Slack")).queryByRole("switch")).toBeNull();
    expect(within(row("GitHub")).queryByRole("switch")).toBeNull();
  });

  it("is still switchless the day it connects — its controls are BP.2's to add", () => {
    card(seededChannels({ push: { state: "connected", until: null, reason: null } }));

    expect(within(row("Mobile push")).queryByRole("switch")).toBeNull();
  });
});

describe("the email digest", () => {
  it("is one switch, on the email row, showing the reader's own setting", () => {
    card();

    expect(within(region()).getAllByRole("switch")).toHaveLength(1);
    expect(within(row("Email")).getByRole("switch", { name: "Daily digest" })).toHaveAttribute("aria-checked", "false");
    expect(row("Email")).toHaveTextContent("off");
    expect(within(row("Email")).getByText("Off — nothing is mailed daily.")).toBeInTheDocument();
    // The time is not offered while there is no digest to time.
    expect(within(row("Email")).queryByRole("textbox")).toBeNull();
  });

  it("shows a digest that is on: daily, its time, and when the next one leaves", () => {
    card(seededChannels(), digestOn("09:00"));

    expect(within(row("Email")).getByRole("switch", { name: "Daily digest" })).toHaveAttribute("aria-checked", "true");
    expect(row("Email")).toHaveTextContent("daily · 09:00 UTC");
    expect(within(row("Email")).getByLabelText("Digest time (UTC)")).toHaveValue("09:00");
    expect(within(row("Email")).getByText("Next digest 2026-10-05 09:00 UTC")).toBeInTheDocument();
  });

  it("switches on straight to the reader's preferences, and shows what the service answered", async () => {
    updateNotificationSettings.mockResolvedValue({ ok: true, value: digestOn("09:00") });
    card();

    fireEvent.click(within(row("Email")).getByRole("switch", { name: "Daily digest" }));
    await settle();

    expect(updateNotificationSettings).toHaveBeenCalledExactlyOnceWith({ digestEnabled: true });
    expect(heard).toEqual([digestOn("09:00")]);
    expect(within(row("Email")).getByRole("switch", { name: "Daily digest" })).toHaveAttribute("aria-checked", "true");
    expect(within(row("Email")).getByText("Next digest 2026-10-05 09:00 UTC")).toBeInTheDocument();
  });

  it("switches off the same way", async () => {
    updateNotificationSettings.mockResolvedValue({ ok: true, value: preferences({ isExplicit: true }) });
    card(seededChannels(), digestOn("09:00"));

    fireEvent.click(within(row("Email")).getByRole("switch", { name: "Daily digest" }));
    await settle();

    expect(updateNotificationSettings).toHaveBeenCalledExactlyOnceWith({ digestEnabled: false });
    expect(within(row("Email")).getByRole("switch", { name: "Daily digest" })).toHaveAttribute("aria-checked", "false");
    expect(within(row("Email")).getByText("Off — nothing is mailed daily.")).toBeInTheDocument();
    expect(within(row("Email")).queryByRole("textbox")).toBeNull();
  });

  it("round-trips a new time, and the next send moves with it", async () => {
    updateNotificationSettings.mockResolvedValue({ ok: true, value: digestOn("17:30") });
    card(seededChannels(), digestOn("09:00"));

    expect(within(row("Email")).getByText("Next digest 2026-10-05 09:00 UTC")).toBeInTheDocument();

    fireEvent.change(within(row("Email")).getByLabelText("Digest time (UTC)"), { target: { value: "17:30" } });
    fireEvent.click(within(row("Email")).getByRole("button", { name: "Set time" }));
    await settle();

    // Only the time is sent: the row never rewrites what the sheet owns (mutes, instant mail).
    expect(updateNotificationSettings).toHaveBeenCalledExactlyOnceWith({ digestTime: "17:30" });
    expect(row("Email")).toHaveTextContent("daily · 17:30 UTC");
    expect(within(row("Email")).getByLabelText("Digest time (UTC)")).toHaveValue("17:30");
    expect(within(row("Email")).getByText("Next digest 2026-10-05 17:30 UTC")).toBeInTheDocument();
    expect(within(row("Email")).queryByText("Next digest 2026-10-05 09:00 UTC")).toBeNull();
  });

  it("saves the time on Enter", async () => {
    updateNotificationSettings.mockResolvedValue({ ok: true, value: digestOn("06:05") });
    card(seededChannels(), digestOn("09:00"));

    const field = within(row("Email")).getByLabelText("Digest time (UTC)");

    fireEvent.change(field, { target: { value: "06:05" } });
    fireEvent.submit(field.closest("form")!);
    await settle();

    expect(updateNotificationSettings).toHaveBeenCalledExactlyOnceWith({ digestTime: "06:05" });
  });

  it("refuses a time that is not one, saying how, and sends nothing", () => {
    card(seededChannels(), digestOn("09:00"));

    const field = within(row("Email")).getByLabelText("Digest time (UTC)");

    fireEvent.change(field, { target: { value: "9am" } });

    expect(within(row("Email")).getByRole("alert")).toHaveTextContent("Use a time like 09:00 (UTC).");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Use a time like 09:00 (UTC).");
    expect(within(row("Email")).getByRole("button", { name: "Set time" })).toHaveAttribute("aria-disabled", "true");

    fireEvent.submit(field.closest("form")!);
    expect(updateNotificationSettings).not.toHaveBeenCalled();
  });

  it("has nothing to save while the time is the one already saved", () => {
    card(seededChannels(), digestOn("09:00"));

    const save = within(row("Email")).getByRole("button", { name: "Set time" });

    expect(save).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(save);
    fireEvent.submit(save.closest("form")!);

    expect(updateNotificationSettings).not.toHaveBeenCalled();
    expect(within(row("Email")).queryByRole("alert")).toBeNull();
  });

  it("says why a save was refused, and keeps showing what is really saved", async () => {
    updateNotificationSettings.mockResolvedValue({
      ok: false,
      reason: "Your notification settings could not be saved. Try again.",
    });
    card();

    fireEvent.click(within(row("Email")).getByRole("switch", { name: "Daily digest" }));
    await settle();

    expect(within(row("Email")).getByRole("alert")).toHaveTextContent(
      "Your notification settings could not be saved. Try again.",
    );
    expect(within(row("Email")).getByRole("switch", { name: "Daily digest" })).toHaveAttribute("aria-checked", "false");
    expect(heard).toEqual([]);
  });

  it("says the save failed when the call itself was lost, and lets the reader try again", async () => {
    updateNotificationSettings.mockRejectedValueOnce(new TypeError("fetch failed"));
    card();

    fireEvent.click(within(row("Email")).getByRole("switch", { name: "Daily digest" }));
    await settle();

    expect(within(row("Email")).getByRole("alert")).toHaveTextContent(
      "Your notification settings could not be saved. Try again.",
    );

    updateNotificationSettings.mockResolvedValue({ ok: true, value: digestOn("09:00") });
    fireEvent.click(within(row("Email")).getByRole("switch", { name: "Daily digest" }));
    await settle();

    expect(within(row("Email")).queryByRole("alert")).toBeNull();
    expect(within(row("Email")).getByRole("switch", { name: "Daily digest" })).toHaveAttribute("aria-checked", "true");
  });

  it("sends one write at a time — a second press while one is in flight is dropped", async () => {
    let land: (outcome: unknown) => void = () => {};

    updateNotificationSettings.mockReturnValue(new Promise((resolve) => (land = resolve)));
    card();

    const digest = within(row("Email")).getByRole("switch", { name: "Daily digest" });

    fireEvent.click(digest);
    fireEvent.click(digest);
    expect(updateNotificationSettings).toHaveBeenCalledOnce();
    expect(digest).toHaveAttribute("aria-disabled", "true");

    land({ ok: true, value: digestOn("09:00") });
    await settle();

    await waitFor(() =>
      expect(within(row("Email")).getByRole("switch", { name: "Daily digest" })).not.toHaveAttribute(
        "aria-disabled",
        "true",
      ),
    );
  });

  it("drops Enter in the time field while a write is in flight — the button is inert, the form is not", async () => {
    let land: (outcome: unknown) => void = () => {};

    updateNotificationSettings.mockReturnValue(new Promise((resolve) => (land = resolve)));
    card(seededChannels(), digestOn("09:00"));

    const field = within(row("Email")).getByLabelText("Digest time (UTC)");

    fireEvent.change(field, { target: { value: "10:30" } });
    fireEvent.submit(field.closest("form")!);
    fireEvent.submit(field.closest("form")!);

    expect(updateNotificationSettings).toHaveBeenCalledExactlyOnceWith({ digestTime: "10:30" });
    expect(within(row("Email")).getByRole("button", { name: "Set time" })).toHaveAccessibleDescription("Saving…");

    land({ ok: true, value: digestOn("10:30") });
    await settle();

    await waitFor(() => expect(row("Email")).toHaveTextContent("daily · 10:30 UTC"));
  });

  it("follows a time saved elsewhere — the sheet's — rather than keep its own", () => {
    const { rerender } = render(
      <ChannelsCard
        channels={seededChannels()}
        failure={null}
        onPreferences={() => {}}
        preferences={{ ok: true, value: digestOn("09:00") }}
      />,
    );

    rerender(
      <ChannelsCard
        channels={seededChannels()}
        failure={null}
        onPreferences={() => {}}
        preferences={{ ok: true, value: digestOn("11:15") }}
      />,
    );

    expect(within(row("Email")).getByLabelText("Digest time (UTC)")).toHaveValue("11:15");
    expect(row("Email")).toHaveTextContent("daily · 11:15 UTC");
  });

  it("offers no switch while email cannot deliver", () => {
    card(
      seededChannels({
        email: { state: "available", reason: "This deployment has no mail server: set OURO_SMTP_URL." },
      }),
    );

    expect(within(region()).queryByRole("switch")).toBeNull();
  });

  it("says so, rather than draw a switch on a guess, when the preferences could not be read", () => {
    card(seededChannels(), null);

    expect(within(region()).queryByRole("switch")).toBeNull();
    expect(within(row("Email")).getByText("Your notification settings could not be read.")).toBeInTheDocument();
  });
});

describe("Chat Ops", () => {
  it("is an honest soon, not a link to a page that is not there", () => {
    card();

    const chatOps = within(region()).getByRole("button", { name: "Chat Ops soon" });

    expect(within(region()).queryByRole("link", { name: /Chat Ops/ })).toBeNull();
    expect(chatOps).toHaveAttribute("aria-disabled", "true");
    expect(chatOps).toHaveAccessibleDescription("The Chat Ops page arrives with #541.");
  });
});

describe("the card's way into the preferences sheet", () => {
  it("opens the sheet on the reader's settings, read when it opens", async () => {
    readNotificationSettings.mockResolvedValue({ ok: true, value: digestOn("08:15") });
    card();

    fireEvent.click(within(region()).getByRole("button", { name: "All notification settings" }));
    await settle();

    const sheet = await screen.findByRole("dialog", { name: "Notification settings" });

    expect(readNotificationSettings).toHaveBeenCalledOnce();
    expect(within(sheet).getByRole("switch", { name: "Daily digest" })).toHaveAttribute("aria-checked", "true");
    expect(within(sheet).getByLabelText("Send at (UTC)")).toHaveValue("08:15");
    // What the sheet read is what the row now says, too.
    expect(row("Email")).toHaveTextContent("daily · 08:15 UTC");
  });

  it("carries a save in the sheet onto the email row", async () => {
    updateNotificationSettings.mockResolvedValue({ ok: true, value: digestOn("07:45") });
    card();

    fireEvent.click(within(region()).getByRole("button", { name: "All notification settings" }));
    await settle();

    const sheet = await screen.findByRole("dialog", { name: "Notification settings" });

    fireEvent.click(within(sheet).getByRole("switch", { name: "Daily digest" }));
    fireEvent.change(within(sheet).getByLabelText("Send at (UTC)"), { target: { value: "07:45" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await settle();

    await waitFor(() => expect(row("Email")).toHaveTextContent("daily · 07:45 UTC"));
    expect(within(row("Email")).getByText("Next digest 2026-10-05 07:45 UTC")).toBeInTheDocument();
  });
});

describe("a card that could not be read", () => {
  it("says so in one line, and still offers the preferences", () => {
    card(null, preferences(), "The inbox's channels and policies could not be reached.");

    expect(within(region()).getByText("The inbox's channels and policies could not be reached.")).toBeInTheDocument();
    expect(within(region()).queryByRole("list")).toBeNull();
    expect(within(region()).getByRole("button", { name: "All notification settings" })).toBeInTheDocument();
  });

  it("draws an empty list for a deployment that states no channels", () => {
    card({ channels: [] });

    expect(within(region()).queryAllByRole("listitem")).toHaveLength(0);
    expect(region().textContent).not.toContain("✓");
  });
});
