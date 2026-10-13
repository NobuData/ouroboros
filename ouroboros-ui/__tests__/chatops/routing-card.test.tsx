import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RoutingCardProps } from "@/app/chatops/routing-card";
import {
  NO_CANDIDATES,
  ON_CALL_FAILED,
  ROTATIONS_NOTE,
  ROUTES_EMPTY,
  ROUTES_UNREAD,
  ROUTE_FAILED,
  ROUTING_ROLE_NOTE,
} from "@/app/chatops/view";

import {
  boundChannelList,
  channel,
  chatRoute,
  chatRoutes,
  deferred,
  onCall,
  routeChannel,
} from "../helpers/chatops";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { settle } from "../helpers/settle";

/**
 * The routing card (#543): rows from #488's routes filtered to chat targets with every word the
 * service's, a channel picker sourced from the bound channels, an optimistic switch that rolls
 * back, the on-call designee named and changed, and the same rows as words for a reader who may
 * not edit.
 */

const setRouteEnabled = vi.fn();
const setRouteChannel = vi.fn();
const setOnCall = vi.fn();

vi.mock("@/app/chatops/routing-actions", () => ({
  setRouteEnabled: (kind: unknown, enabled: unknown) => setRouteEnabled(kind, enabled),
  setRouteChannel: (kind: unknown, id: unknown) => setRouteChannel(kind, id),
  setOnCall: (memberId: unknown) => setOnCall(memberId),
}));

const { RoutingCard } = await import("@/app/chatops/routing-card");

const onRoute = vi.fn();
const onOnCall = vi.fn();
const onAddChannel = vi.fn();

beforeEach(() => {
  for (const mock of [setRouteEnabled, setRouteChannel, setOnCall, onRoute, onOnCall, onAddChannel]) mock.mockReset();
});

/**
 * The card, for an owner on the seeded routes, unless told otherwise.
 *
 * @param over What differs.
 * @returns The element.
 */
function Routing(over: Partial<RoutingCardProps> = {}) {
  return (
    <RoutingCard
      channels={boundChannelList()}
      mayAdminister
      onAddChannel={onAddChannel}
      onCall={{ ok: true, value: onCall() }}
      onOnCall={onOnCall}
      onRoute={onRoute}
      routes={{ ok: true, value: chatRoutes() }}
      titleId="routing"
      {...over}
    />
  );
}

/** The rows, in order. */
function rows(): HTMLElement[] {
  return screen.getAllByRole("listitem");
}

/**
 * The row of one event.
 *
 * @param label The event's label.
 * @returns The row.
 */
function row(label: string): HTMLElement {
  return rows().find((one) => one.querySelector(".chatops-side__evt")!.textContent!.startsWith(label))!;
}

/**
 * A row's switch.
 *
 * @param label The event's label.
 * @returns The switch.
 */
function toggle(label: string): HTMLElement {
  return screen.getByRole("switch", { name: `Publish: ${label}` });
}

/**
 * A row's channel picker.
 *
 * @param label The event's label.
 * @returns The picker.
 */
function picker(label: string): HTMLSelectElement {
  return screen.getByRole("combobox", { name: `Channel for ${label}` });
}

describe("the rows", () => {
  it("are the routes that post to a chat channel, in the served order, under the mockup's title", () => {
    render(Routing());

    expect(screen.getByRole("region", { name: "WHAT GETS PUBLISHED WHERE" })).toBeInTheDocument();
    expect(rows().map((one) => one.querySelector(".chatops-side__evt")!.textContent)).toEqual([
      "Loop finished (merged)",
      "Blocking questions",
      "Build failures",
      "Weekly insights report",
      "Every stage transition — noisy, off by default",
    ]);
    expect(screen.queryByText("daily_digest")).toBeNull();
  });

  it("print the service's label and qualifier verbatim, whatever they are", () => {
    const routes = {
      items: [chatRoute("custom:deploys", { label: "Deploys (prod only)", note: "an invented qualifier" })],
      channels: [],
    };

    render(Routing({ routes: { ok: true, value: routes } }));

    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.querySelector(".chatops-side__evt")).toHaveTextContent("Deploys (prod only) — an invented qualifier");
    expect(screen.getByText("— an invented qualifier")).toHaveClass("chatops-side__evt-note");
  });

  it("draw the stage-transition route off, with its warning", () => {
    render(Routing());

    expect(toggle("Every stage transition")).toHaveAttribute("aria-checked", "false");
    expect(within(row("Every stage transition")).getByText("— noisy, off by default")).toHaveClass(
      "chatops-side__evt-note",
    );
    expect(toggle("Build failures")).toHaveAttribute("aria-checked", "true");
  });

  it("link Manage in Settings to the notifications section, once", () => {
    render(Routing());

    expect(screen.getByRole("link", { name: "Manage in Settings →" })).toHaveAttribute("href", "/settings#notifications");
  });
});

describe("a row's channel picker", () => {
  it("offers only the bound channels, shows the route's own, and a way to add one", () => {
    render(Routing({ channels: [...boundChannelList(), channel("general")] }));

    const select = picker("Build failures");

    expect(select).toHaveValue(channel("helios-alerts").id);
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "#ouroboros-loops",
      "#helios-alerts",
      "+ Add a channel…",
    ]);
  });

  it("says choose a channel on a route with none", () => {
    render(Routing());

    const select = picker("Every stage transition");

    expect(select).toHaveValue("");
    expect(select.options[0]).toHaveTextContent("choose a channel");
  });

  it("writes the picked channel as the route's chatChannelId, and hands the answer up", async () => {
    const loops = channel("ouroboros-loops").id;
    const answer = chatRoute("custom:build-failures", { label: "Build failures", channel: routeChannel("ouroboros-loops") });

    setRouteChannel.mockResolvedValueOnce(answer);
    render(Routing());

    fireEvent.change(picker("Build failures"), { target: { value: loops } });

    expect(setRouteChannel).toHaveBeenCalledWith("custom:build-failures", loops);
    expect(picker("Build failures")).toHaveValue(loops);
    await settle();

    expect(onRoute).toHaveBeenCalledWith(answer);
    expect(setRouteEnabled).not.toHaveBeenCalled();
  });

  it("puts the channel back and says why when the service refuses", async () => {
    setRouteChannel.mockResolvedValueOnce({ error: "That channel is not bound to this workspace." });
    render(Routing());

    fireEvent.change(picker("Build failures"), { target: { value: channel("ouroboros-loops").id } });

    expect(await within(row("Build failures")).findByRole("alert")).toHaveTextContent(
      "That channel is not bound to this workspace.",
    );
    expect(picker("Build failures")).toHaveValue(channel("helios-alerts").id);
    expect(onRoute).not.toHaveBeenCalled();
  });

  it("opens the add-a-channel sheet from its own choice, writing nothing", () => {
    render(Routing());

    fireEvent.change(picker("Weekly insights report"), { target: { value: "+" } });

    expect(onAddChannel).toHaveBeenCalledTimes(1);
    expect(setRouteChannel).not.toHaveBeenCalled();
    expect(picker("Weekly insights report")).toHaveValue("");
  });

  it("says so when the route's channel cannot be posted to", () => {
    const routes = chatRoutes();

    routes.items[3] = chatRoute("custom:build-failures", {
      label: "Build failures",
      channel: routeChannel("helios-alerts", { joined: false }),
    });
    routes.items[1] = chatRoute("custom:loop-finished", {
      label: "Loop finished (merged)",
      channel: { id: "gone", name: "old-builds", joined: true, archived: true },
    });
    render(Routing({ routes: { ok: true, value: routes } }));

    expect(within(row("Build failures")).getByRole("note")).toHaveTextContent(
      "Ouroboros is not in this channel — nothing is posted there",
    );
    expect(within(row("Loop finished")).getByRole("note")).toHaveTextContent("archived in Slack");
    // A channel that is no longer bound is still the one shown: the picker never lies about the route.
    expect(picker("Loop finished (merged)").selectedOptions[0]).toHaveTextContent("#old-builds");
  });
});

describe("a row's switch", () => {
  it("flips at once, writes enabled alone, and hands the answer up", async () => {
    const pending = deferred<unknown>();
    const answer = chatRoute("custom:build-failures", { label: "Build failures" }, { enabled: false });

    setRouteEnabled.mockReturnValueOnce(pending.promise);
    render(Routing());

    fireEvent.click(toggle("Build failures"));

    expect(toggle("Build failures")).toHaveAttribute("aria-checked", "false");
    expect(setRouteEnabled).toHaveBeenCalledWith("custom:build-failures", false);
    expect(onRoute).not.toHaveBeenCalled();

    // A second press while the first is on its way is not a second write.
    fireEvent.click(toggle("Build failures"));
    expect(setRouteEnabled).toHaveBeenCalledTimes(1);

    pending.resolve(answer);
    await settle();

    expect(onRoute).toHaveBeenCalledWith(answer);
  });

  it("rolls back with the service's reason when the write is refused", async () => {
    setRouteEnabled.mockResolvedValueOnce({ error: "Choose a channel for this route before switching it on." });
    render(Routing());

    fireEvent.click(toggle("Every stage transition"));
    expect(toggle("Every stage transition")).toHaveAttribute("aria-checked", "true");
    expect(setRouteEnabled).toHaveBeenCalledWith("custom:stage-transitions", true);

    expect(await within(row("Every stage transition")).findByRole("alert")).toHaveTextContent(
      "Choose a channel for this route before switching it on.",
    );
    expect(toggle("Every stage transition")).toHaveAttribute("aria-checked", "false");
    expect(onRoute).not.toHaveBeenCalled();
  });

  it("rolls back with its own sentence when the write never reached the service", async () => {
    setRouteEnabled.mockRejectedValueOnce(new TypeError("fetch failed"));
    render(Routing());

    fireEvent.click(toggle("Build failures"));

    expect(await within(row("Build failures")).findByRole("alert")).toHaveTextContent(ROUTE_FAILED);
    expect(toggle("Build failures")).toHaveAttribute("aria-checked", "true");
  });

  it("cannot be pressed on a locked route, which says why", () => {
    const routes = chatRoutes();

    routes.items[3] = chatRoute(
      "custom:build-failures",
      { label: "Build failures" },
      { locked: true, lockedReason: "connect Slack first", enabled: false, delivering: false },
    );
    render(Routing({ routes: { ok: true, value: routes } }));

    fireEvent.click(toggle("Build failures"));

    expect(setRouteEnabled).not.toHaveBeenCalled();
    expect(toggle("Build failures")).toHaveAttribute("aria-disabled", "true");
    expect(within(row("Build failures")).getByText("connect Slack first")).toBeInTheDocument();
  });
});

describe("+ DM on-call", () => {
  it("is on the routes that DM, names the designee, and says rotations are not here yet", () => {
    render(Routing());

    const row_ = row("Blocking questions");

    expect(within(row_).getByText("+ DM on-call (Maya Chen)")).not.toHaveClass("chatops-side__oncall-who--warn");
    expect(within(row_).getByText(ROTATIONS_NOTE)).toHaveTextContent("rotations arrive with #548");
    expect(within(row("Build failures")).queryByText(/DM on-call/)).toBeNull();
  });

  it("says nobody is designated, or that the designee is not linked, as a warning", () => {
    render(Routing({ onCall: { ok: true, value: onCall({ designee: null }) } }));
    expect(screen.getByText("+ DM on-call (nobody designated)")).toHaveClass("chatops-side__oncall-who--warn");
    cleanup();

    render(
      Routing({
        onCall: { ok: true, value: onCall({ designee: { memberId: "member-maya", name: "Maya Chen", linked: false } }) },
      }),
    );
    expect(screen.getByText("+ DM on-call (Maya Chen — not linked to Slack)")).toHaveClass(
      "chatops-side__oncall-who--warn",
    );
  });

  it("changes the designee from a picker of the linked members, and hands the answer up", async () => {
    const answer = onCall({ designee: { memberId: "member-ken", name: "Ken Suenobu", linked: true } });

    setOnCall.mockResolvedValueOnce(answer);
    render(Routing());

    expect(screen.queryByRole("combobox", { name: "On-call designee" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change the on-call designee" }));

    const select = screen.getByRole<HTMLSelectElement>("combobox", { name: "On-call designee" });

    expect(select).toHaveValue("member-maya");
    expect([...select.options].map((option) => option.textContent)).toEqual(["Ken Suenobu", "Maya Chen", "Nobody"]);

    fireEvent.change(select, { target: { value: "member-ken" } });
    expect(setOnCall).toHaveBeenCalledWith("member-ken");
    await settle();

    expect(onOnCall).toHaveBeenCalledWith(answer);
    expect(screen.queryByRole("combobox", { name: "On-call designee" })).toBeNull();
    expect(screen.getByRole("button", { name: "Change the on-call designee" })).toBeInTheDocument();
  });

  it("designates nobody with null", async () => {
    setOnCall.mockResolvedValueOnce(onCall({ designee: null }));
    render(Routing());

    fireEvent.click(screen.getByRole("button", { name: "Change the on-call designee" }));
    fireEvent.change(screen.getByRole("combobox", { name: "On-call designee" }), { target: { value: "" } });
    await settle();

    expect(setOnCall).toHaveBeenCalledWith(null);
  });

  it("keeps the picker open and says why when the designation is refused", async () => {
    setOnCall.mockResolvedValueOnce({ error: "Ken has not linked a Slack identity." });
    render(Routing());

    fireEvent.click(screen.getByRole("button", { name: "Change the on-call designee" }));
    fireEvent.change(screen.getByRole("combobox", { name: "On-call designee" }), { target: { value: "member-ken" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Ken has not linked a Slack identity.");
    expect(screen.getByRole("combobox", { name: "On-call designee" })).toHaveValue("member-maya");
    expect(onOnCall).not.toHaveBeenCalled();

    setOnCall.mockRejectedValueOnce(new TypeError("fetch failed"));
    fireEvent.change(screen.getByRole("combobox", { name: "On-call designee" }), { target: { value: "member-ken" } });

    expect(await screen.findByText(ON_CALL_FAILED)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "On-call designee" })).toBeNull();
  });

  it("says members must link first when nobody can be designated", () => {
    render(Routing({ onCall: { ok: true, value: onCall({ designee: null, candidates: [] }) } }));

    fireEvent.click(screen.getByRole("button", { name: "Change the on-call designee" }));

    expect(screen.getByText(NO_CANDIDATES)).toHaveTextContent("/ouro link");
    expect(screen.queryByRole("combobox", { name: "On-call designee" })).toBeNull();
  });

  it("keeps the row, without a name or a Change, when the on-call resource could not be read", () => {
    render(Routing({ onCall: { ok: false, reason: "nope" } }));

    expect(within(row("Blocking questions")).getByText("+ DM on-call (designee could not be read)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change the on-call designee" })).toBeNull();
    expect(toggle("Blocking questions")).toBeInTheDocument();
  });
});

describe("a reader who may not edit", () => {
  it("reads the same rows as words, with the reason and no control", () => {
    render(Routing({ mayAdminister: false }));

    expect(rows()).toHaveLength(5);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();

    expect(row("Build failures")).toHaveTextContent("→#helios-alerts");
    expect(within(row("Build failures")).getByText("on")).toHaveClass("chatops-side__state");
    expect(within(row("Every stage transition")).getByText("off")).toBeInTheDocument();
    expect(row("Every stage transition")).toHaveTextContent("no channel chosen");
    expect(row("Blocking questions")).toHaveTextContent("+ DM on-call (Maya Chen)");

    expect(screen.getByText(ROUTING_ROLE_NOTE)).toHaveTextContent(
      "Changing what gets published where is for an Owner or a Maintainer.",
    );
    expect(screen.getByRole("link", { name: "Manage in Settings →" })).toBeInTheDocument();
  });
});

describe("the card's own states", () => {
  it("says the routes could not be read, with the service's reason, and keeps the way to Settings", () => {
    render(Routing({ routes: { ok: false, reason: "The routes could not be loaded." } }));

    expect(screen.getByText(ROUTES_UNREAD)).toBeInTheDocument();
    expect(screen.getByText("The routes could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.getByRole("link", { name: "Manage in Settings →" })).toBeInTheDocument();
  });

  it("says so when no route posts to a chat channel", () => {
    render(Routing({ routes: { ok: true, value: { items: [chatRoute("daily_digest", null)], channels: [] } } }));

    expect(screen.getByText(ROUTES_EMPTY)).toBeInTheDocument();
  });

  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(Routing());
    cleanup();

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
