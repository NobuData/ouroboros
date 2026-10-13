import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatOpsScreenProps } from "@/app/chatops/chatops-screen";
import { BOUND_TITLE, COMMANDS_UNREAD, COMPOSER_LABEL, ROUTES_UNREAD } from "@/app/chatops/view";

import { signedIn } from "../helpers/account";
import {
  CHATOPS_READ_AT,
  boundChannelList,
  channel,
  channels,
  chatOpsPage,
  chatRoute,
  chatRoutes,
  fresh,
  onCall,
  routeChannel,
} from "../helpers/chatops";
import { consoleActions, resetConsoleActions } from "../helpers/console";
import { settle } from "../helpers/settle";

/**
 * The commands and routing cards on the page (#543): where they sit, **Try it** reaching the
 * mirror's real composer, the picker's way back to #541's sheet, and a write here drawn at once
 * and confirmed by the page's one poll — the same poll a change made in Settings arrives on.
 */

const setRouteEnabled = vi.fn();
const setRouteChannel = vi.fn();
const setOnCall = vi.fn();

vi.mock("@/app/chatops/routing-actions", () => ({
  setRouteEnabled: (kind: unknown, enabled: unknown) => setRouteEnabled(kind, enabled),
  setRouteChannel: (kind: unknown, id: unknown) => setRouteChannel(kind, id),
  setOnCall: (memberId: unknown) => setOnCall(memberId),
}));
vi.mock("@/app/chatops/chatops-actions", () => ({
  verifyConnection: vi.fn(),
  refreshChannels: vi.fn(),
  bindChannel: vi.fn(),
  unbindChannel: vi.fn(),
}));
vi.mock("@/app/api/auth-client", async () => (await import("../helpers/account")).authClientModule());
vi.mock("@/app/shell/console-actions", async () => (await import("../helpers/console")).consoleActionsModule());

const { ChatOpsScreen } = await import("@/app/chatops/chatops-screen");

beforeEach(() => {
  for (const mock of [setRouteEnabled, setRouteChannel, setOnCall]) mock.mockReset();
  resetConsoleActions();
  signedIn();
});

/** A workspace with its loops and alerts channels bound. */
const BOUND = chatOpsPage({ channels: channels(boundChannelList()) });

/**
 * The screen, for an owner on the bound workspace, with neither poll answering unless told.
 *
 * @param over What differs.
 * @returns The element.
 */
function Screen(over: Partial<ChatOpsScreenProps> = {}) {
  return (
    <ChatOpsScreen
      mayAdminister
      mirror={{ read: () => new Promise(() => undefined) }}
      page={{ ok: true, value: BOUND }}
      poll={{ read: () => new Promise(() => undefined) }}
      readAt={CHATOPS_READ_AT}
      {...over}
    />
  );
}

/** The mirror's composer box. */
function box(): HTMLInputElement {
  return screen.getByRole("combobox", { name: COMPOSER_LABEL });
}

describe("where the cards sit", () => {
  it("is the side column: commands, what gets published where, AI presence, then the bound channels", () => {
    render(<Screen />);

    const side = document.querySelector(".chatops__side")!;

    expect([...side.children].map((card) => card.getAttribute("aria-labelledby")).map((id) => document.getElementById(id!)!.textContent)).toEqual([
      "COMMANDS",
      "WHAT GETS PUBLISHED WHERE",
      "AI PRESENCE",
      BOUND_TITLE,
    ]);
  });

  it("points the AI-presence preview at the commands card that is on the page", () => {
    render(<Screen />);

    const pointer = within(screen.getByRole("region", { name: "AI PRESENCE" })).getByRole("link", {
      name: "today, the /ouro commands do this deterministically →",
    });
    const target = document.getElementById(pointer.getAttribute("href")!.slice(1));

    expect(target).toBe(screen.getByRole("region", { name: "COMMANDS" }));
  });

  it("keeps the AI-presence preview when no mirror can be shown", () => {
    render(<Screen page={{ ok: true, value: { ...BOUND, grammar: { ok: false, reason: "The grammar could not be loaded." } } }} />);

    expect(screen.getByRole("region", { name: "AI PRESENCE" })).toBeInTheDocument();
  });

  it("shows Manage in Settings once — in the routing card", () => {
    render(<Screen />);

    const link = screen.getByRole("link", { name: "Manage in Settings →" });

    expect(link.closest(".chatops-side__routing")).not.toBeNull();
    expect(document.querySelector(".chatops__foot")).toBeNull();
  });

  it("is not there at all before a channel is bound", () => {
    render(<Screen page={{ ok: true, value: chatOpsPage() }} />);

    expect(screen.queryByRole("region", { name: "COMMANDS" })).toBeNull();
    expect(screen.queryByRole("region", { name: "WHAT GETS PUBLISHED WHERE" })).toBeNull();
    expect(screen.queryByRole("region", { name: "AI PRESENCE" })).toBeNull();
    expect(screen.getByRole("link", { name: "Manage in Settings →" }).closest(".chatops__foot")).not.toBeNull();
  });

  it("degrades one card when its read failed, and leaves the others standing", () => {
    render(
      <Screen
        page={{
          ok: true,
          value: {
            ...BOUND,
            grammar: { ok: false, reason: "The grammar could not be loaded." },
            routes: { ok: false, reason: "The routes could not be loaded." },
          },
        }}
      />,
    );

    expect(within(screen.getByRole("region", { name: "COMMANDS" })).getByText(COMMANDS_UNREAD)).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "WHAT GETS PUBLISHED WHERE" })).getByText(ROUTES_UNREAD),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: BOUND_TITLE })).toBeInTheDocument();
    expect(box()).toBeInTheDocument();
  });
});

describe("Try it", () => {
  it("prefills the mirror's composer with the command's skeleton and focuses it, sending nothing", async () => {
    render(<Screen />);

    fireEvent.click(screen.getByRole("button", { name: "Try /ouro queue in the composer" }));
    await settle();

    expect(box()).toHaveValue("/ouro queue ");
    expect(box()).toHaveFocus();
    expect(box().selectionStart).toBe("/ouro queue ".length);
    expect(consoleActions.runConsoleCommand).not.toHaveBeenCalled();
  });

  it("works a second time for the same command, and after the reader typed over it", async () => {
    render(<Screen />);

    const again = screen.getByRole("button", { name: "Try /ouro status in the composer" });

    fireEvent.click(again);
    await settle();
    again.focus();
    fireEvent.click(again);
    await settle();

    expect(box()).toHaveValue("/ouro status ");
    expect(box()).toHaveFocus();

    fireEvent.change(box(), { target: { value: "something else" } });
    fireEvent.click(again);
    await settle();

    expect(box()).toHaveValue("/ouro status ");
    expect(consoleActions.runConsoleCommand).not.toHaveBeenCalled();
  });
});

describe("the routing card's writes", () => {
  it("opens #541's sheet from a row's add-a-channel choice", () => {
    render(<Screen />);

    fireEvent.change(screen.getByRole("combobox", { name: "Channel for Weekly insights report" }), {
      target: { value: "+" },
    });

    expect(screen.getByRole("dialog", { name: "Add a channel" })).toBeInTheDocument();
  });

  it("draws a repointed route at once, and asks the poll to confirm it", async () => {
    const loops = channel("ouroboros-loops").id;
    const moved = chatRoute("custom:build-failures", { label: "Build failures", channel: routeChannel("ouroboros-loops") });
    const read = vi.fn().mockResolvedValue(fresh(BOUND));

    setRouteChannel.mockResolvedValueOnce(moved);
    render(<Screen poll={{ read, visible: () => true }} />);
    await waitFor(() => expect(read).toHaveBeenCalled());
    await settle();

    const asked = read.mock.calls.length;
    const after = chatRoutes();

    after.items[3] = moved;
    // What the service — and Settings, reading the same store — now says.
    read.mockResolvedValue(fresh({ ...BOUND, routes: { ok: true, value: after } }));

    fireEvent.change(screen.getByRole("combobox", { name: "Channel for Build failures" }), { target: { value: loops } });
    await settle();

    expect(setRouteChannel).toHaveBeenCalledWith("custom:build-failures", loops);
    expect(screen.getByRole("combobox", { name: "Channel for Build failures" })).toHaveValue(loops);
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(asked));
    await settle();
    expect(screen.getByRole("combobox", { name: "Channel for Build failures" })).toHaveValue(loops);
  });

  it("shows a route changed elsewhere — in Settings — on the next poll, with no write here", async () => {
    const after = chatRoutes();

    after.items[3] = chatRoute("custom:build-failures", { label: "Build failures" }, { enabled: false });

    const read = vi.fn().mockResolvedValue(fresh({ ...BOUND, routes: { ok: true, value: after } }));

    render(<Screen poll={{ read, visible: () => true }} />);

    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Publish: Build failures" })).toHaveAttribute("aria-checked", "false"),
    );
    expect(setRouteEnabled).not.toHaveBeenCalled();
  });

  it("keeps a switched route switched once its answer lands", async () => {
    setRouteEnabled.mockResolvedValueOnce(
      chatRoute("custom:build-failures", { label: "Build failures", channel: routeChannel("helios-alerts") }, { enabled: false }),
    );
    render(<Screen />);

    fireEvent.click(screen.getByRole("switch", { name: "Publish: Build failures" }));
    await settle();

    expect(setRouteEnabled).toHaveBeenCalledWith("custom:build-failures", false);
    expect(screen.getByRole("switch", { name: "Publish: Build failures" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Publish: Loop finished (merged)" })).toHaveAttribute("aria-checked", "true");
  });

  it("redraws the designee once a designation lands", async () => {
    setOnCall.mockResolvedValueOnce(onCall({ designee: { memberId: "member-ken", name: "Ken Suenobu", linked: true } }));
    render(<Screen />);

    fireEvent.click(screen.getByRole("button", { name: "Change the on-call designee" }));
    fireEvent.change(screen.getByRole("combobox", { name: "On-call designee" }), { target: { value: "member-ken" } });
    await settle();

    expect(setOnCall).toHaveBeenCalledWith("member-ken");
    expect(screen.getByText("+ DM on-call (Ken Suenobu)")).toBeInTheDocument();
  });

  it("offers a reader who may not edit no control in either card but Try it", () => {
    render(<Screen mayAdminister={false} />);

    const routing = screen.getByRole("region", { name: "WHAT GETS PUBLISHED WHERE" });

    expect(within(routing).queryByRole("switch")).toBeNull();
    expect(within(routing).queryByRole("combobox")).toBeNull();
    expect(within(routing).getByText(/an Owner or a Maintainer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try /ouro status in the composer" })).toBeInTheDocument();
  });
});
