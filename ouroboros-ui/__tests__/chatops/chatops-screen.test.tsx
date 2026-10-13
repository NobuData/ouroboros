import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatOpsScreenProps } from "@/app/chatops/chatops-screen";
import {
  ADD_CHANNEL_LABEL,
  BIND_ROLE_REASON,
  BOUND_TITLE,
  CHANNELS_UNREAD,
  CHATOPS_HEADLINE,
  CHATOPS_SUBLINE,
  COMPOSER_LABEL,
  DELIVERY_AUDIT_LABEL,
  DELIVERY_LABEL,
  DELIVERY_RETRYING_LABEL,
  DELIVERY_RETRY_FAILED,
  DELIVERY_RETRY_LABEL,
  DELIVERY_ROLE_NOTE,
  ERROR_NOTE,
  FIRST_CHANNELS_LEAD,
  FIRST_CHANNELS_TITLE,
  HEALTH_LABEL,
  HISTORY_LABEL,
  HISTORY_NOTE,
  INSTALL_NOTE,
  INSTALL_ROLE_NOTE,
  NOT_CONFIGURED_MISSING,
  NOT_CONFIGURED_TITLE,
  NOT_CONFIGURED_WHO,
  NOT_CONNECTED_LEAD,
  NOT_CONNECTED_MISSING,
  NOT_CONNECTED_TITLE,
  PURPOSE_ROUTES,
  REGISTRATION_NOTE,
  REINSTALL_ROLE_NOTE,
  REVOKED_NOTE,
  SETUP_GUIDE_HREF,
  SETUP_STEPS,
  SHOWING_MIRROR_LABEL,
  SHOW_MIRROR_LABEL,
  STALE_HEADLINE,
  UNLINKED_LABEL,
  UNLINKED_TITLE,
  UNREAD_HEADLINE,
  VERIFY_FAILED,
} from "@/app/chatops/view";

import {
  CHATOPS_READ_AT,
  INSTALL_PATH,
  boundChannelList,
  channels,
  chatOpsPage,
  connection,
  deadLettering,
  deferred,
  delivery,
  fresh,
  freshMirror,
  mirror,
  mirrorLine,
  notConfigured,
  notConnected,
  revoked,
} from "../helpers/chatops";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { settle } from "../helpers/settle";

/**
 * The Chat Ops page (#541): the head verbatim with each action there only when it is true, the
 * health strip in every state, the install journey for a reader who can install and one who
 * cannot, the post-install step, the bound channels — and one poll that keeps all of it current.
 */

const verifyConnection = vi.fn();
const refreshChannels = vi.fn();
const bindChannel = vi.fn();
const unbindChannel = vi.fn();
const retryDelivery = vi.fn();

// The routing card's writes (#543) have a suite of their own; here they are only kept off the server.
vi.mock("@/app/chatops/routing-actions", () => ({
  setRouteEnabled: vi.fn(),
  setRouteChannel: vi.fn(),
  setOnCall: vi.fn(),
}));

vi.mock("@/app/chatops/chatops-actions", () => ({
  verifyConnection: () => verifyConnection(),
  refreshChannels: () => refreshChannels(),
  bindChannel: (id: unknown, purpose: unknown) => bindChannel(id, purpose),
  unbindChannel: (id: unknown) => unbindChannel(id),
  retryDelivery: () => retryDelivery(),
}));

// The channel mirror's composer (#542) is the console's: its Server Actions and the session it
// keys its history by are stubbed, as the palette's suites stub them.
vi.mock("@/app/api/auth-client", async () => (await import("../helpers/account")).authClientModule());
vi.mock("@/app/shell/console-actions", async () => (await import("../helpers/console")).consoleActionsModule());

const { ChatOpsScreen } = await import("@/app/chatops/chatops-screen");

beforeEach(() => {
  for (const mock of [verifyConnection, refreshChannels, bindChannel, unbindChannel, retryDelivery]) mock.mockReset();
});

/** A workspace with its loops and alerts channels bound. */
const BOUND = chatOpsPage({ channels: channels(boundChannelList()) });

/**
 * The screen, for an owner on a connected workspace with nothing bound, unless told otherwise.
 *
 * @param over What differs.
 * @returns The element.
 */
function Screen(over: Partial<ChatOpsScreenProps> = {}) {
  return (
    <ChatOpsScreen
      mayAdminister
      page={{ ok: true, value: chatOpsPage() }}
      // Neither poll answers unless a case says so: the page is what the server read.
      mirror={{ read: () => new Promise(() => undefined) }}
      poll={{ read: () => new Promise(() => undefined) }}
      readAt={CHATOPS_READ_AT}
      {...over}
    />
  );
}

/**
 * The screen on one page.
 *
 * @param value The page.
 * @param mayAdminister Whether the reader is an owner or an admin.
 * @returns The element.
 */
function on(value: ReturnType<typeof chatOpsPage>, mayAdminister = true) {
  return <Screen mayAdminister={mayAdminister} page={{ ok: true, value }} />;
}

/** The health strip. */
function strip(): HTMLElement {
  return screen.getByRole("region", { name: HEALTH_LABEL });
}

describe("the head", () => {
  it("states the page's argument verbatim, and adds no navigation chrome of its own", () => {
    render(<Screen />);

    expect(screen.getByText("Chat Ops", { selector: ".ou-eyebrow" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(CHATOPS_HEADLINE);
    expect(screen.getByText(CHATOPS_SUBLINE)).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("offers both actions on a connected workspace with a loops channel", () => {
    render(on(BOUND));

    const add = screen.getByRole("button", { name: ADD_CHANNEL_LABEL });
    const open = screen.getByRole("link", { name: "Open #ouroboros-loops ↗" });

    expect(add).not.toHaveAttribute("aria-disabled");
    expect(add).toHaveAttribute("aria-haspopup", "dialog");
    expect(open).toHaveAttribute("href", "https://app.slack.com/client/T024AB/C0OUROBO");
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noreferrer");
  });

  it("leaves Open out — absent, not disabled — while no channel is bound for loops", () => {
    render(<Screen />);

    expect(screen.getByRole("button", { name: ADD_CHANNEL_LABEL })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Open #.* ↗$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Open #/ })).toBeNull();
  });

  it("makes Add channel inert, with the reason, for a reader who is not an owner or an admin", () => {
    render(on(BOUND, false));

    const add = screen.getByRole("button", { name: ADD_CHANNEL_LABEL });

    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(add).toHaveAccessibleDescription(BIND_ROLE_REASON);

    fireEvent.click(add);
    expect(screen.queryByRole("dialog")).toBeNull();
    // Opening the real channel is everyone's.
    expect(screen.getByRole("link", { name: "Open #ouroboros-loops ↗" })).toBeInTheDocument();
  });

  it.each([
    ["not_configured", notConfigured()],
    ["not_connected", notConnected()],
    ["revoked", revoked()],
    ["error", connection({ state: "error", statusDetail: "ratelimited" })],
  ])("draws neither action while Slack is %s", (_state, slack) => {
    render(on(chatOpsPage({ connection: slack, channels: channels(boundChannelList()) })));

    expect(screen.queryByRole("button", { name: ADD_CHANNEL_LABEL })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Open #.* ↗$/ })).toBeNull();
  });

  it("opens the picker from Add channel", () => {
    render(<Screen />);

    fireEvent.click(screen.getByRole("button", { name: ADD_CHANNEL_LABEL }));

    expect(screen.getByRole("dialog", { name: "Add a channel" })).toBeInTheDocument();
  });
});

describe("the connection health strip", () => {
  it("reports a healthy connection in words: workspace · app · scopes · status · verified", () => {
    render(on(BOUND));

    expect(strip()).toHaveTextContent("acme-robotics·app v2.4·scopes ✓·active·verified 2m ago");
    expect(within(strip()).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "acme-robotics",
      "·app v2.4",
      "·scopes ✓",
      "·active",
      "·verified 2m ago",
    ]);
    // The separators are decoration; the facts are the text.
    for (const dot of strip().querySelectorAll(".chatops__fact-sep")) expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(within(strip()).queryByRole("link")).toBeNull();
  });

  it("is not drawn before a connection exists", () => {
    const { unmount } = render(on(chatOpsPage({ connection: notConfigured() })));
    expect(screen.queryByRole("region", { name: HEALTH_LABEL })).toBeNull();
    unmount();

    render(on(chatOpsPage({ connection: notConnected() })));
    expect(screen.queryByRole("region", { name: HEALTH_LABEL })).toBeNull();
  });

  it("names the missing scopes", () => {
    render(on(chatOpsPage({ connection: connection({ missingScopes: ["chat:write", "groups:read"] }) })));

    expect(strip()).toHaveTextContent("2 scopes missing: chat:write, groups:read");
    expect(strip()).toHaveTextContent("active");
  });

  it("says revoked with Slack's reason, and offers an owner Re-install", () => {
    render(on(chatOpsPage({ connection: revoked() })));

    expect(strip()).toHaveTextContent("revoked — app_uninstalled");
    expect(strip()).toHaveTextContent(REVOKED_NOTE);

    const reinstall = within(strip()).getByRole("link", { name: "Re-install" });

    // A plain link: following it is the full-page navigation the install needs.
    expect(reinstall).toHaveAttribute("href", INSTALL_PATH);
    expect(reinstall).not.toHaveAttribute("target");
    expect(strip()).not.toHaveTextContent(REINSTALL_ROLE_NOTE);
  });

  it("tells a reader who cannot re-install who can", () => {
    render(on(chatOpsPage({ connection: revoked() }), false));

    expect(strip()).toHaveTextContent("revoked — app_uninstalled");
    expect(strip()).toHaveTextContent(`${REVOKED_NOTE} ${REINSTALL_ROLE_NOTE}`);
    expect(within(strip()).queryByRole("link")).toBeNull();
    expect(within(strip()).queryByRole("button")).toBeNull();
  });

  it("says error with the platform's reason, and offers the same repair", () => {
    render(on(chatOpsPage({ connection: connection({ state: "error", statusDetail: "ratelimited" }) })));

    expect(strip()).toHaveTextContent("error — ratelimited");
    expect(strip()).toHaveTextContent(ERROR_NOTE);
    expect(within(strip()).getByRole("link", { name: "Re-install" })).toHaveAttribute("href", INSTALL_PATH);
  });

  it("offers Verify now to an owner or an admin only", () => {
    const { unmount } = render(on(BOUND));
    expect(within(strip()).getByRole("button", { name: "Verify now" })).toBeInTheDocument();
    unmount();

    render(on(BOUND, false));
    expect(within(strip()).queryByRole("button")).toBeNull();
  });

  it("verifies on the spot: the pressed control says so, and the strip redraws from the answer", async () => {
    const answer = deferred<unknown>();
    verifyConnection.mockReturnValueOnce(answer.promise);
    render(on(BOUND));

    fireEvent.click(within(strip()).getByRole("button", { name: "Verify now" }));

    const verifying = await within(strip()).findByRole("button", { name: "Verifying…" });
    expect(verifying).toHaveAttribute("aria-disabled", "true");
    // Only the pressed control is pending.
    expect(screen.getByRole("button", { name: ADD_CHANNEL_LABEL })).not.toHaveAttribute("aria-disabled");

    await act(async () => {
      answer.resolve({ result: "revoked", connection: revoked() });
    });

    expect(await within(strip()).findByText("revoked — app_uninstalled")).toBeInTheDocument();
    expect(within(strip()).getByRole("button", { name: "Verify now" })).not.toHaveAttribute("aria-disabled");
    // Revoked: the head's actions go with the connection.
    expect(screen.queryByRole("button", { name: ADD_CHANNEL_LABEL })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Open #.* ↗$/ })).toBeNull();
  });

  it("prints a refused verification in the service's words, and is a button again", async () => {
    verifyConnection.mockResolvedValueOnce({ error: "Only an owner or an admin may verify." });
    render(on(BOUND));

    fireEvent.click(within(strip()).getByRole("button", { name: "Verify now" }));

    expect(await within(strip()).findByRole("alert")).toHaveTextContent("Only an owner or an admin may verify.");
    expect(within(strip()).getByRole("button", { name: "Verify now" })).not.toHaveAttribute("aria-disabled");
  });

  it("says so when a verification never reached the service", async () => {
    verifyConnection.mockRejectedValueOnce(new TypeError("fetch failed"));
    render(on(BOUND));

    fireEvent.click(within(strip()).getByRole("button", { name: "Verify now" }));

    expect(await within(strip()).findByRole("alert")).toHaveTextContent(VERIFY_FAILED);
    // The pending label is cleared by the same transition; under load it can land a tick later.
    await waitFor(() => {
      expect(within(strip()).queryByRole("button", { name: "Verifying…" })).toBeNull();
    });
  });
});

describe("the journey on a deployment with no Slack app", () => {
  it.each([
    ["an owner", true],
    ["a viewer", false],
  ])("explains per-deployment registration, the steps and the guide to %s — with no Install", (_who, admin) => {
    render(on(chatOpsPage({ connection: notConfigured() }), admin));

    const journey = screen.getByRole("region", { name: NOT_CONFIGURED_TITLE });

    expect(journey).toHaveTextContent(REGISTRATION_NOTE);
    expect(within(journey).getAllByRole("listitem").map((step) => step.textContent)).toEqual([...SETUP_STEPS]);
    expect(journey).toHaveTextContent(`${NOT_CONFIGURED_MISSING} ${NOT_CONFIGURED_WHO}`);

    const guide = within(journey).getByRole("link", { name: "Read the setup guide ↗" });

    expect(guide).toHaveAttribute("href", SETUP_GUIDE_HREF);
    expect(guide).toHaveAttribute("target", "_blank");
    // Nothing to install yet: no Install, live or dead.
    expect(within(journey).getAllByRole("link")).toHaveLength(1);
    expect(within(journey).queryByRole("button")).toBeNull();
    expect(journey).not.toHaveTextContent(/\bInstall\b(?! the| it)/);
  });
});

describe("the journey where the app is registered and not installed", () => {
  it("offers an owner Install — a plain link to the install route — beside the guide", () => {
    render(on(chatOpsPage({ connection: notConnected() })));

    const journey = screen.getByRole("region", { name: NOT_CONNECTED_TITLE });
    const install = within(journey).getByRole("link", { name: "Install" });

    expect(journey).toHaveTextContent(REGISTRATION_NOTE);
    expect(journey).toHaveTextContent(`${NOT_CONNECTED_LEAD} ${INSTALL_NOTE}`);
    expect(install).toHaveAttribute("href", INSTALL_PATH);
    expect(install).not.toHaveAttribute("target");
    expect(within(journey).getByRole("link", { name: "Read the setup guide ↗" })).toHaveAttribute(
      "href",
      SETUP_GUIDE_HREF,
    );
    expect(journey).not.toHaveTextContent(INSTALL_ROLE_NOTE);
  });

  it("shows a reader who cannot install what is missing and who can fix it — and no Install", () => {
    render(on(chatOpsPage({ connection: notConnected() }), false));

    const journey = screen.getByRole("region", { name: NOT_CONNECTED_TITLE });

    expect(journey).toHaveTextContent(REGISTRATION_NOTE);
    expect(journey).toHaveTextContent(`${NOT_CONNECTED_MISSING} ${INSTALL_ROLE_NOTE}`);
    expect(within(journey).queryByRole("link", { name: "Install" })).toBeNull();
    expect(within(journey).queryByRole("button")).toBeNull();
    expect(within(journey).getByRole("link", { name: "Read the setup guide ↗" })).toBeInTheDocument();
  });

  it("is gone once Slack is connected", () => {
    render(<Screen />);

    expect(screen.queryByRole("region", { name: NOT_CONNECTED_TITLE })).toBeNull();
    expect(screen.queryByRole("region", { name: NOT_CONFIGURED_TITLE })).toBeNull();
  });
});

describe("the post-install step", () => {
  it("names the three purposes, the routes each switches on, and the invite", () => {
    render(<Screen />);

    const block = screen.getByRole("region", { name: FIRST_CHANNELS_TITLE });
    const rows = within(block).getAllByRole("listitem");

    expect(block).toHaveTextContent(FIRST_CHANNELS_LEAD);
    expect(rows.map((row) => row.querySelector(".chatops__purpose-name")?.textContent)).toEqual([
      "Loops",
      "Alerts",
      "Leads",
    ]);
    expect(rows[0]).toHaveTextContent(PURPOSE_ROUTES.loops);
    expect(rows[1]).toHaveTextContent(PURPOSE_ROUTES.alerts);
    expect(rows[2]).toHaveTextContent(PURPOSE_ROUTES.leads);
    expect(block).toHaveTextContent(
      "Ouroboros can only post where it is a member. In each channel, send /invite @Ouroboros first.",
    );
    expect(block.querySelector("code")).toHaveTextContent("/invite @Ouroboros");
  });

  it("opens the picker already set to the purpose whose button was pressed", () => {
    render(<Screen />);

    fireEvent.click(screen.getByRole("button", { name: "Choose an Alerts channel" }));

    const dialog = screen.getByRole("dialog", { name: "Add a channel for Alerts" });

    fireEvent.click(within(dialog).getByRole("button", { name: /^#helios-alerts/ }));

    expect(within(dialog).getByRole("radio", { name: /^Alerts/ })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /^Loops/ })).not.toBeChecked();
  });

  it("keeps the step visible, and its buttons inert with the reason, for a reader who cannot bind", () => {
    render(<Screen mayAdminister={false} />);

    const block = screen.getByRole("region", { name: FIRST_CHANNELS_TITLE });
    const buttons = within(block).getAllByRole("button");

    expect(buttons.map((button) => button.textContent)).toEqual([
      "Choose a Loops channel",
      "Choose an Alerts channel",
      "Choose a Leads channel",
    ]);
    for (const button of buttons) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAccessibleDescription(BIND_ROLE_REASON);
    }

    fireEvent.click(buttons[0]!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("gives way to the bound list once a channel has a purpose", () => {
    render(on(BOUND));

    expect(screen.queryByRole("region", { name: FIRST_CHANNELS_TITLE })).toBeNull();
    expect(screen.getByRole("region", { name: BOUND_TITLE })).toBeInTheDocument();
  });
});

describe("the bound channels", () => {
  /** The list's card. */
  const list = () => screen.getByRole("region", { name: BOUND_TITLE });

  it("lists each purposed channel: name, purpose, members, routes and the way out to Slack", () => {
    render(on(BOUND));

    const rows = within(list()).getAllByRole("listitem");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("#ouroboros-loops");
    expect(rows[0]).toHaveTextContent("Loops");
    expect(rows[0]).toHaveTextContent("24 members · routes: blocking_question, loop_finished");
    expect(rows[1]).toHaveTextContent("#helios-alerts");
    expect(rows[1]).toHaveTextContent("Alerts");
    expect(rows[1]).toHaveTextContent("9 members · routes: build_failure");

    const open = within(rows[1]!).getByRole("link", { name: "Open #helios-alerts in Slack" });

    expect(open).toHaveTextContent("Open ↗");
    expect(open).toHaveAttribute("href", "https://app.slack.com/client/T024AB/C0HELIOS");
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noreferrer");
  });

  it("offers Unbind to an owner or an admin only", () => {
    const { unmount } = render(on(BOUND));
    expect(within(list()).getByRole("button", { name: "Unbind #helios-alerts" })).toBeInTheDocument();
    unmount();

    render(on(BOUND, false));
    // Showing a row's mirror (#542) is every member's; unbinding is not.
    expect(within(list()).queryByRole("button", { name: /^Unbind/ })).toBeNull();
    expect(within(list()).getAllByRole("link")).toHaveLength(2);
  });

  it("unbinds: only the pressed row says so, and the page redraws from the answer", async () => {
    const answer = deferred<unknown>();
    unbindChannel.mockReturnValueOnce(answer.promise);
    render(on(BOUND));

    fireEvent.click(within(list()).getByRole("button", { name: "Unbind #helios-alerts" }));

    const pressed = await within(list()).findByRole("button", { name: "Unbind #helios-alerts" });
    await settle();
    expect(pressed).toHaveTextContent("Unbinding…");
    expect(within(list()).getByRole("button", { name: "Unbind #ouroboros-loops" })).toHaveTextContent("Unbind");
    expect(unbindChannel).toHaveBeenCalledWith(boundChannelList()[1]!.id);

    await act(async () => {
      answer.resolve(channels([boundChannelList()[0]!, ...channels().channels.slice(1)]));
    });

    expect(within(list()).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list()).queryByText("#helios-alerts")).toBeNull();
  });

  it("prints a refused unbind in the service's words, and leaves the row a button", async () => {
    unbindChannel.mockResolvedValueOnce({ error: "Only an owner or an admin may unbind a channel." });
    render(on(BOUND));

    fireEvent.click(within(list()).getByRole("button", { name: "Unbind #helios-alerts" }));

    expect(await within(list()).findByRole("alert")).toHaveTextContent(
      "Only an owner or an admin may unbind a channel.",
    );
    expect(within(list()).getByRole("button", { name: "Unbind #helios-alerts" })).toHaveTextContent("Unbind");
    expect(within(list()).getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("Manage in Settings", () => {
  it.each([
    ["connected", BOUND],
    ["not installed", chatOpsPage({ connection: notConnected() })],
  ])("links to the notifications section while Slack is %s", (_state, value) => {
    render(on(value));

    expect(screen.getByRole("link", { name: "Manage in Settings →" })).toHaveAttribute(
      "href",
      "/settings#notifications",
    );
  });
});

describe("staying current", () => {
  it("shows a connection Slack revoked without a reload", async () => {
    const read = vi.fn().mockResolvedValue(fresh(chatOpsPage({ connection: revoked(), channels: channels(boundChannelList()) })));

    render(<Screen page={{ ok: true, value: BOUND }} poll={{ read, visible: () => true }} />);

    expect(await within(strip()).findByText("revoked — app_uninstalled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ADD_CHANNEL_LABEL })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Open #.* ↗$/ })).toBeNull();
    // What was bound is still listed — to look back on, not to change (#545).
    expect(within(screen.getByRole("region", { name: BOUND_TITLE })).queryByRole("button", { name: /^Unbind/ })).toBeNull();
  });

  it("raises a retry banner over the page as last read when a re-read fails", async () => {
    const read = vi.fn().mockResolvedValue({ state: "failed", reason: "ouroboros-rest is restarting.", pollAfterSeconds: 15 });

    render(<Screen page={{ ok: true, value: BOUND }} poll={{ read, visible: () => true }} />);

    const banner = (await screen.findByText(STALE_HEADLINE)).closest(".ou-retry") as HTMLElement;

    expect(banner).toHaveTextContent("ouroboros-rest is restarting.");
    // Still the page it was.
    expect(strip()).toHaveTextContent("active");
    expect(screen.getByRole("region", { name: BOUND_TITLE })).toBeInTheDocument();

    fireEvent.click(within(banner).getByRole("button"));
    await settle();
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("says the connection could not be read when the first read failed, under the real head", () => {
    render(<Screen page={{ ok: false, reason: "ouroboros-rest answered 500." }} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(CHATOPS_HEADLINE);
    expect(screen.getByText(UNREAD_HEADLINE)).toBeInTheDocument();
    expect(screen.getByText("ouroboros-rest answered 500.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ADD_CHANNEL_LABEL })).toBeNull();
    expect(screen.queryByRole("region", { name: HEALTH_LABEL })).toBeNull();
  });

  it("draws the page once a poll answers, after a first read that failed", async () => {
    const read = vi.fn().mockResolvedValue(fresh(BOUND));

    render(<Screen page={{ ok: false, reason: "ouroboros-rest answered 500." }} poll={{ read, visible: () => true }} />);

    expect(await screen.findByRole("region", { name: BOUND_TITLE })).toBeInTheDocument();
    expect(screen.queryByText(UNREAD_HEADLINE)).toBeNull();
  });

  it("degrades only the lists when the channels could not be read", () => {
    render(
      <Screen
        page={{ ok: true, value: { ...chatOpsPage(), channels: { ok: false, reason: "Slack did not answer." } } }}
      />,
    );

    expect(strip()).toHaveTextContent("active");
    expect(screen.getByText(CHANNELS_UNREAD)).toBeInTheDocument();
    expect(screen.getByText("Slack did not answer.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: FIRST_CHANNELS_TITLE })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Open #.* ↗$/ })).toBeNull();
  });
});

describe("the channel mirror", () => {
  const [LOOPS, ALERTS] = boundChannelList() as [ReturnType<typeof boundChannelList>[number], ReturnType<typeof boundChannelList>[number]];

  /** Each channel's own page, so which mirror is showing can be read off the stream. */
  const read = vi.fn((id: string) =>
    Promise.resolve(
      freshMirror(
        mirror({
          channel: id === ALERTS.id ? ALERTS : LOOPS,
          entries: [mirrorLine({ text: id === ALERTS.id ? "the alerts record" : "the loops record" })],
        }),
      ),
    ),
  );

  beforeEach(() => {
    read.mockClear();
    window.history.replaceState(null, "", "/chatops");
  });

  it("shows the first bound channel's mirror beside the bound list", async () => {
    render(<Screen mirror={{ read, visible: () => true }} page={{ ok: true, value: BOUND }} />);

    const card = screen.getByRole("region", { name: "Mirror of #ouroboros-loops" });

    expect(await within(card).findByText("the loops record")).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith(LOOPS.id, null);
    expect(card.closest(".chatops__main")).not.toBeNull();
    expect(screen.getByRole("region", { name: BOUND_TITLE }).closest(".chatops__side")).not.toBeNull();
    expect(card.closest(".chatops__body")).toHaveClass("chatops__body--wide");
  });

  it("shows the channel the address names", async () => {
    render(<Screen channel={ALERTS.id} mirror={{ read, visible: () => true }} page={{ ok: true, value: BOUND }} />);

    expect(await screen.findByText("the alerts record")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Mirror of #helios-alerts" })).toBeInTheDocument();
    expect(read).not.toHaveBeenCalledWith(LOOPS.id, null);
  });

  it("falls back to the first bound channel when the address names one that is not bound", async () => {
    render(<Screen channel="not-a-channel" mirror={{ read, visible: () => true }} page={{ ok: true, value: BOUND }} />);

    expect(await screen.findByText("the loops record")).toBeInTheDocument();
  });

  it("lets every row show its mirror, says which is showing, and keeps the choice in the address", async () => {
    render(<Screen mayAdminister={false} mirror={{ read, visible: () => true }} page={{ ok: true, value: BOUND }} />);

    const loops = screen.getByRole("button", { name: "Show the mirror of #ouroboros-loops" });
    const alerts = screen.getByRole("button", { name: "Show the mirror of #helios-alerts" });

    expect(loops).toHaveAttribute("aria-pressed", "true");
    expect(loops).toHaveTextContent(SHOWING_MIRROR_LABEL);
    expect(alerts).toHaveAttribute("aria-pressed", "false");
    expect(alerts).toHaveTextContent(SHOW_MIRROR_LABEL);

    fireEvent.click(alerts);

    expect(await screen.findByText("the alerts record")).toBeInTheDocument();
    expect(screen.queryByText("the loops record")).toBeNull();
    expect(alerts).toHaveAttribute("aria-pressed", "true");
    expect(window.location.search).toBe(`?channel=${ALERTS.id}`);
    expect(window.location.pathname).toBe("/chatops");
  });

  it("draws no mirror on a page with nothing bound, or with no connection", () => {
    const { unmount } = render(<Screen mirror={{ read, visible: () => true }} />);

    expect(screen.queryByRole("region", { name: /^Mirror of/ })).toBeNull();
    expect(screen.getByRole("region", { name: FIRST_CHANNELS_TITLE })).toBeInTheDocument();
    unmount();

    render(<Screen mirror={{ read, visible: () => true }} page={{ ok: true, value: chatOpsPage({ connection: notConnected() }) }} />);

    expect(screen.queryByRole("region", { name: /^Mirror of/ })).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("moves to the next bound channel when the one showing is unbound", async () => {
    unbindChannel.mockResolvedValueOnce(channels([{ ...LOOPS, purpose: null, routes: [] }, ALERTS]));
    render(<Screen mirror={{ read, visible: () => true }} page={{ ok: true, value: BOUND }} />);

    await screen.findByText("the loops record");
    fireEvent.click(screen.getByRole("button", { name: "Unbind #ouroboros-loops" }));

    expect(await screen.findByRole("region", { name: "Mirror of #helios-alerts" })).toBeInTheDocument();
    expect(await screen.findByText("the alerts record")).toBeInTheDocument();
  });
});

describe("publish health (#545)", () => {
  /** The banner, or null when it is not drawn. */
  function banner(): HTMLElement | null {
    return screen.queryByRole("status", { name: DELIVERY_LABEL });
  }

  /** A bound workspace whose connection has dead letters. */
  const DEAD = chatOpsPage({ connection: deadLettering(), channels: channels(boundChannelList()) });

  it("is not drawn while every message is going out", () => {
    render(on(BOUND));

    expect(banner()).toBeNull();
  });

  it("says how many messages were not delivered, on which route, and Slack's last answer", () => {
    render(on(DEAD));

    expect(banner()).toHaveTextContent("2 messages could not be delivered to Slack.");
    expect(banner()).toHaveTextContent("Affected: Build failures.");
    expect(banner()).toHaveTextContent("Slack's last answer: channel_not_found.");
    expect(within(banner()!).getByRole("link", { name: DELIVERY_AUDIT_LABEL })).toHaveAttribute(
      "href",
      "/settings#audit",
    );
  });

  it("offers the retry to an owner or an admin, and tells everyone else who can", () => {
    const { unmount } = render(on(DEAD));

    expect(within(banner()!).getByRole("button", { name: DELIVERY_RETRY_LABEL })).toBeInTheDocument();
    expect(banner()).not.toHaveTextContent(DELIVERY_ROLE_NOTE);
    unmount();

    render(on(DEAD, false));

    expect(within(banner()!).queryByRole("button", { name: DELIVERY_RETRY_LABEL })).toBeNull();
    expect(banner()).toHaveTextContent(DELIVERY_ROLE_NOTE);
  });

  it("retries: the control says so while it is out, and the banner goes with the drained queue", async () => {
    const answer = deferred<unknown>();
    retryDelivery.mockReturnValueOnce(answer.promise);
    render(on(DEAD));

    fireEvent.click(within(banner()!).getByRole("button", { name: DELIVERY_RETRY_LABEL }));

    const retrying = await within(banner()!).findByRole("button", { name: DELIVERY_RETRYING_LABEL });

    expect(retrying).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      answer.resolve(connection({ delivery: delivery({ state: "healthy", pending: 2 }) }));
    });

    await waitFor(() => expect(banner()).toBeNull());
    expect(retryDelivery).toHaveBeenCalledTimes(1);
  });

  it("prints a refused retry in the service's words, and is a button again", async () => {
    retryDelivery.mockResolvedValueOnce({ error: "This workspace is not connected to Slack." });
    render(on(DEAD));

    fireEvent.click(within(banner()!).getByRole("button", { name: DELIVERY_RETRY_LABEL }));

    expect(await within(banner()!).findByRole("alert")).toHaveTextContent("This workspace is not connected to Slack.");
    expect(within(banner()!).getByRole("button", { name: DELIVERY_RETRY_LABEL })).not.toHaveAttribute("aria-disabled");
  });

  it("says a retry could not be made at all when the call itself fails", async () => {
    retryDelivery.mockRejectedValueOnce(new Error("network"));
    render(on(DEAD));

    fireEvent.click(within(banner()!).getByRole("button", { name: DELIVERY_RETRY_LABEL }));

    expect(await within(banner()!).findByRole("alert")).toHaveTextContent(DELIVERY_RETRY_FAILED);
  });

  it("appears on the page's own poll, without a reload", async () => {
    const read = vi.fn().mockResolvedValue(fresh(DEAD));

    render(<Screen page={{ ok: true, value: BOUND }} poll={{ read, visible: () => true }} />);

    expect(banner()).toBeNull();
    expect(await screen.findByRole("status", { name: DELIVERY_LABEL })).toBeInTheDocument();
  });

  it("disappears on the poll that reads a drained queue", async () => {
    const read = vi.fn().mockResolvedValue(fresh(BOUND));

    render(<Screen page={{ ok: true, value: DEAD }} poll={{ read, visible: () => true }} />);

    expect(banner()).not.toBeNull();
    await waitFor(() => expect(banner()).toBeNull());
  });

  it("says a message keeps failing while it is still being retried, and offers no retry", () => {
    const stuck = connection({
      delivery: delivery({ state: "retrying", retrying: 1, stuck: 1, affectedRoutes: ["custom:loop-finished"] }),
    });

    render(on(chatOpsPage({ connection: stuck, channels: channels(boundChannelList()) })));

    expect(banner()).toHaveTextContent("1 message keeps failing to reach Slack, and is still being retried.");
    expect(within(banner()!).queryByRole("button", { name: DELIVERY_RETRY_LABEL })).toBeNull();
  });
});

describe("the unlinked reader (#545)", () => {
  it("is told once, in the mirror, while Slack is connected and they have no link", () => {
    const unlinked = chatOpsPage({ connection: connection({ viewerLinked: false }), channels: channels(boundChannelList()) });

    render(on(unlinked));

    expect(screen.getByRole("region", { name: UNLINKED_LABEL })).toHaveTextContent(UNLINKED_TITLE);
    // Nothing in the app is taken away: the composer is still there.
    expect(screen.getByRole("combobox", { name: COMPOSER_LABEL })).toBeInTheDocument();
  });

  it("is told nothing when linked", () => {
    render(on(BOUND));

    expect(screen.queryByRole("region", { name: UNLINKED_LABEL })).toBeNull();
  });
});

describe("a revoked or failing connection's history (#545)", () => {
  it.each([
    ["revoked", revoked()],
    ["error", connection({ state: "error", statusDetail: "ratelimited", viewerLinked: false })],
  ])("keeps the %s workspace's mirror, read-only: no composer, no unbind, no unlinked banner", (_state, slack) => {
    render(on(chatOpsPage({ connection: slack, channels: channels(boundChannelList(), { connected: false }) })));

    const history = screen.getByRole("region", { name: HISTORY_LABEL });

    expect(within(history).getByRole("region", { name: "Mirror of #ouroboros-loops" })).toHaveTextContent(HISTORY_NOTE);
    expect(within(history).queryByRole("combobox", { name: COMPOSER_LABEL })).toBeNull();
    expect(within(history).queryByRole("button", { name: /^Unbind/ })).toBeNull();
    expect(within(history).queryByRole("region", { name: UNLINKED_LABEL })).toBeNull();
    // The side cards that write — commands, routing, AI presence — are not drawn.
    expect(screen.queryByRole("region", { name: "COMMANDS" })).toBeNull();
    expect(screen.queryByRole("region", { name: "WHAT GETS PUBLISHED WHERE" })).toBeNull();
  });

  it("still chooses between the channels that were bound", () => {
    render(on(chatOpsPage({ connection: revoked(), channels: channels(boundChannelList(), { connected: false }) })));

    fireEvent.click(screen.getByRole("button", { name: "Show the mirror of #helios-alerts" }));

    expect(screen.getByRole("region", { name: "Mirror of #helios-alerts" })).toBeInTheDocument();
  });

  it("draws no history where nothing was bound", () => {
    render(on(chatOpsPage({ connection: revoked(), channels: channels(undefined, { connected: false }) })));

    expect(screen.queryByRole("region", { name: HISTORY_LABEL })).toBeNull();
  });

  it("says why Slack stopped accepting the app, in words, on the strip", () => {
    render(on(chatOpsPage({ connection: revoked() })));

    expect(strip()).toHaveTextContent("The app was removed from the Slack workspace.");
  });
});

describe("both themes", () => {
  it.each([
    ["bound", BOUND],
    ["dead-lettering", chatOpsPage({ connection: deadLettering(), channels: channels(boundChannelList()) })],
    ["unlinked", chatOpsPage({ connection: connection({ viewerLinked: false }), channels: channels(boundChannelList()) })],
    ["revoked with history", chatOpsPage({ connection: revoked(), channels: channels(boundChannelList(), { connected: false }) })],
    ["revoked", chatOpsPage({ connection: revoked() })],
    ["not configured", chatOpsPage({ connection: notConfigured() })],
    ["not installed", chatOpsPage({ connection: notConnected() })],
    ["nothing bound", chatOpsPage()],
  ])("render the same markup when %s — the palettes are the tokens' business", (_state, value) => {
    const [light, dark] = renderInBothPalettes(on(value));
    cleanup();

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
