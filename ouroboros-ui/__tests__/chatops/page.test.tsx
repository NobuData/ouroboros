import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/app/api/membership";
import {
  ADD_CHANNEL_LABEL,
  BIND_ROLE_REASON,
  CHATOPS_HEADLINE,
  HEALTH_LABEL,
  INSTALL_ROLE_NOTE,
  NOT_CONNECTED_TITLE,
  UNREAD_HEADLINE,
} from "@/app/chatops/view";

import { CHATOPS_READ_AT, boundChannelList, channels, chatOpsPage, notConnected, revoked } from "../helpers/chatops";
import { membership, sessionUser } from "../helpers/login";

/**
 * The Chat Ops route (#541): the gate is asked first, the page's reads are made once, and the
 * reader's roles decide who may install, verify and bind.
 */

const requireWorkspace = vi.fn();
const readChatOps = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/chatops/chatops-data", () => ({ readChatOps: () => readChatOps() }));
vi.mock("@/app/chatops/chatops-actions", () => ({
  verifyConnection: () => Promise.resolve({ error: "x" }),
  refreshChannels: () => Promise.resolve({ error: "x" }),
  bindChannel: () => Promise.resolve({ error: "x" }),
  unbindChannel: () => Promise.resolve({ error: "x" }),
}));

// The channel mirror's composer (#542) is the console's: its Server Actions and the session it
// keys its history by are stubbed, as the palette's suites stub them.
vi.mock("@/app/api/auth-client", async () => (await import("../helpers/account")).authClientModule());
vi.mock("@/app/shell/console-actions", async () => (await import("../helpers/console")).consoleActionsModule());

const Page = (await import("@/app/(app)/chatops/page")).default;

/**
 * What the gate hands back, for a reader holding these roles.
 *
 * @param roles The roles. Defaults to the seed's owner.
 * @returns The workspace.
 */
function access(roles: Role[] = ["owner"]) {
  return {
    session: { user: sessionUser(), memberships: [membership({ roles })], tenantSuggestion: null },
    membership: membership({ roles }),
  };
}

/**
 * What the page read.
 *
 * @param page The connection and the channels.
 * @returns The readings.
 */
function readings(page = chatOpsPage({ channels: channels(boundChannelList()) })) {
  return { page: { ok: true, value: page }, readAt: CHATOPS_READ_AT };
}

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue(access());
  readChatOps.mockReset().mockResolvedValue(readings());
  // The screen's poll asks this origin; in this suite nothing answers.
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
});

describe("/chatops", () => {
  it("asks the gate before it reads anything", async () => {
    requireWorkspace.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(Page()).rejects.toThrow("NEXT_REDIRECT");
    expect(readChatOps).not.toHaveBeenCalled();
  });

  it("draws the head, the strip and the channels from one read", async () => {
    render(await Page());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(CHATOPS_HEADLINE);
    expect(screen.getByRole("region", { name: HEALTH_LABEL })).toHaveTextContent("verified 2m ago");
    expect(screen.getByRole("link", { name: "Open #ouroboros-loops ↗" })).toBeInTheDocument();
    expect(readChatOps).toHaveBeenCalledTimes(1);
  });

  it("shows the mirror of the channel the address names, and of the first bound one otherwise", async () => {
    const alerts = boundChannelList()[1]!;

    const { unmount } = render(await Page({ searchParams: Promise.resolve({ channel: alerts.id }) }));
    expect(screen.getByRole("region", { name: "Mirror of #helios-alerts" })).toBeInTheDocument();
    unmount();

    render(await Page({ searchParams: Promise.resolve({ channel: ["a", "b"] }) }));
    expect(screen.getByRole("region", { name: "Mirror of #ouroboros-loops" })).toBeInTheDocument();
    cleanup();

    render(await Page());
    expect(screen.getByRole("region", { name: "Mirror of #ouroboros-loops" })).toBeInTheDocument();
  });

  it.each<[Role[], boolean]>([
    [["owner"], true],
    [["admin"], true],
    [["member"], false],
    [["viewer"], false],
  ])("lets %j bind and verify: %s", async (roles, may) => {
    requireWorkspace.mockResolvedValueOnce(access(roles));
    render(await Page());

    const add = screen.getByRole("button", { name: ADD_CHANNEL_LABEL });

    if (may) {
      expect(add).not.toHaveAttribute("aria-disabled");
      expect(screen.getByRole("button", { name: "Verify now" })).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /^Unbind #/ })).toHaveLength(2);
    } else {
      expect(add).toHaveAccessibleDescription(BIND_ROLE_REASON);
      expect(screen.queryByRole("button", { name: "Verify now" })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Unbind #/ })).toBeNull();
    }
  });

  it("offers Install to an admin and the who-can-fix-it sentence to a member", async () => {
    readChatOps.mockResolvedValue(readings(chatOpsPage({ connection: notConnected() })));

    requireWorkspace.mockResolvedValueOnce(access(["admin"]));
    render(await Page());
    expect(screen.getByRole("region", { name: NOT_CONNECTED_TITLE })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Install" })).toBeInTheDocument();
    cleanup();

    requireWorkspace.mockResolvedValueOnce(access(["member"]));
    render(await Page());
    expect(screen.queryByRole("link", { name: "Install" })).toBeNull();
    expect(screen.getByText(new RegExp(INSTALL_ROLE_NOTE))).toBeInTheDocument();
  });

  it("offers Re-install on a revoked connection to an owner only", async () => {
    readChatOps.mockResolvedValue(readings(chatOpsPage({ connection: revoked() })));

    render(await Page());
    expect(screen.getByRole("link", { name: "Re-install" })).toBeInTheDocument();
    cleanup();

    requireWorkspace.mockResolvedValueOnce(access(["viewer"]));
    render(await Page());
    expect(screen.queryByRole("link", { name: "Re-install" })).toBeNull();
    expect(screen.getByRole("region", { name: HEALTH_LABEL })).toHaveTextContent("revoked — app_uninstalled");
  });

  it("still renders — head and all — when the connection could not be read", async () => {
    readChatOps.mockResolvedValueOnce({
      page: { ok: false, reason: "ouroboros-rest answered 500." },
      readAt: CHATOPS_READ_AT,
    });
    render(await Page());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(CHATOPS_HEADLINE);
    expect(screen.getByText(UNREAD_HEADLINE)).toBeInTheDocument();
    expect(screen.getByText("ouroboros-rest answered 500.")).toBeInTheDocument();
  });
});
