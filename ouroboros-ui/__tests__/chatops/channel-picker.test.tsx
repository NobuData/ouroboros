import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SlackChannels } from "@/app/api/chatops";
import {
  ADD_CHANNEL_LABEL,
  BIND_FAILED,
  BOUND_TITLE,
  CHOOSE_PURPOSE_REASON,
  FIRST_CHANNELS_TITLE,
  NO_CHANNELS,
  PICKER_LIST_LABEL,
  PICKER_NOTE,
  PURPOSE_ROUTES,
  REFRESH_FAILED,
  notJoinedNote,
} from "@/app/chatops/view";

import {
  CHATOPS_READ_AT,
  NOT_JOINED_MESSAGE,
  boundChannelList,
  channel,
  channels,
  chatOpsPage,
  deferred,
  unboundChannels,
} from "../helpers/chatops";
import { settle } from "../helpers/settle";

/**
 * **+ Add channel ▾** (#541), through the page it changes: the workspace's channels, what one is
 * for, a bind that updates the page, and — the acceptance criterion — a channel the bot cannot
 * post to failing **with an explanation, not a spinner**.
 */

const refreshChannels = vi.fn();
const bindChannel = vi.fn();
const unbindChannel = vi.fn();

// The routing card's writes (#543) have a suite of their own; here they are only kept off the server.
vi.mock("@/app/chatops/routing-actions", () => ({
  setRouteEnabled: vi.fn(),
  setRouteChannel: vi.fn(),
  setOnCall: vi.fn(),
}));
vi.mock("@/app/chatops/chatops-actions", () => ({
  verifyConnection: () => Promise.resolve({ error: "x" }),
  refreshChannels: () => refreshChannels(),
  bindChannel: (id: unknown, purpose: unknown) => bindChannel(id, purpose),
  unbindChannel: (id: unknown) => unbindChannel(id),
}));

// The channel mirror's composer (#542) is the console's: its Server Actions and the session it
// keys its history by are stubbed, as the palette's suites stub them.
vi.mock("@/app/api/auth-client", async () => (await import("../helpers/account")).authClientModule());
vi.mock("@/app/shell/console-actions", async () => (await import("../helpers/console")).consoleActionsModule());

const { ChatOpsScreen } = await import("@/app/chatops/chatops-screen");

beforeEach(() => {
  for (const mock of [refreshChannels, bindChannel, unbindChannel]) mock.mockReset();
});

const LOOPS = unboundChannels()[0]!;
const PRIVATE = unboundChannels()[2]!;

/**
 * Open the picker on a connected workspace.
 *
 * @param list The workspace's channels. Defaults to four with nothing bound.
 * @returns The dialog.
 */
function openPicker(list: SlackChannels = channels()): HTMLElement {
  render(
    <ChatOpsScreen
      mayAdminister
      mirror={{ read: () => new Promise(() => undefined) }}
      page={{ ok: true, value: chatOpsPage({ channels: list }) }}
      poll={{ read: () => new Promise(() => undefined) }}
      readAt={CHATOPS_READ_AT}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: ADD_CHANNEL_LABEL }));

  return screen.getByRole("dialog", { name: "Add a channel" });
}

/**
 * Choose a channel's row.
 *
 * @param dialog The picker.
 * @param name The channel's name, without the `#`.
 */
function choose(dialog: HTMLElement, name: string): void {
  const row = within(dialog).getByRole("button", { name: new RegExp(`^#${name}\\b`) });

  // A press moves focus in a browser; `fireEvent.click` alone would leave it on the panel.
  row.focus();
  fireEvent.click(row);
}

describe("the channel list", () => {
  it("lists the workspace's channels with what is known of each, and hides the archived", () => {
    const dialog = openPicker(channels(boundChannelList()));
    const rows = within(within(dialog).getByRole("list", { name: PICKER_LIST_LABEL })).getAllByRole("listitem");

    expect(dialog).toHaveTextContent(PICKER_NOTE);
    expect(rows.map((row) => row.querySelector(".chatops__pick")?.textContent)).toEqual([
      "#helios-alerts 9 members · bot is a member · bound for Alerts",
      "#ouroboros-loops 24 members · bot is a member · bound for Loops",
      "#helios-private private · bot is not in this channel",
    ]);
    expect(dialog).not.toHaveTextContent("old-builds");
    expect(dialog).toHaveTextContent("Listed from Slack 5m ago.");
  });

  it("keeps a channel the bot is not in listed, and as pressable as the rest", () => {
    const dialog = openPicker();
    const row = within(dialog).getByRole("button", { name: /^#helios-private/ });

    expect(row).not.toHaveAttribute("aria-disabled");
    expect(row).not.toBeDisabled();
  });

  it("explains an empty list, and offers the refresh", () => {
    const dialog = openPicker(channels([]));

    expect(dialog).toHaveTextContent(NO_CHANNELS);
    expect(within(dialog).queryByRole("list")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Refresh from Slack" })).toBeInTheDocument();
  });

  it("treats a workspace whose every channel is archived as empty", () => {
    const dialog = openPicker(channels([channel("old-builds", { archived: true })]));

    expect(dialog).toHaveTextContent(NO_CHANNELS);
  });

  it("closes on Done, and opens again from the list with nothing chosen", () => {
    const dialog = openPicker();

    choose(dialog, "ouroboros-loops");
    fireEvent.click(within(dialog).getByRole("button", { name: "Back to channels" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: ADD_CHANNEL_LABEL }));
    expect(within(screen.getByRole("dialog")).getByRole("list", { name: PICKER_LIST_LABEL })).toBeInTheDocument();
  });
});

describe("saying what a channel is for", () => {
  it("asks the question, with each purpose's routes, and binds nothing until one is chosen", () => {
    const dialog = openPicker();

    choose(dialog, "ouroboros-loops");

    expect(within(dialog).getByRole("heading", { name: "What is #ouroboros-loops for?" })).toBeInTheDocument();

    const radios = within(within(dialog).getByRole("radiogroup")).getAllByRole("radio");

    expect(radios).toHaveLength(3);
    expect(radios.every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(within(dialog).getByRole("radio", { name: `Loops ${PURPOSE_ROUTES.loops}` })).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: `Alerts ${PURPOSE_ROUTES.alerts}` })).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: `Leads ${PURPOSE_ROUTES.leads}` })).toBeInTheDocument();

    const bind = within(dialog).getByRole("button", { name: "Bind" });

    expect(bind).toHaveAttribute("aria-disabled", "true");
    expect(bind).toHaveAccessibleDescription(CHOOSE_PURPOSE_REASON);
    fireEvent.click(bind);
    expect(bindChannel).not.toHaveBeenCalled();
  });

  it("keeps the dialog's keyboard after the step changes: focus lands on the question, and Escape closes", () => {
    const dialog = openPicker();

    choose(dialog, "ouroboros-loops");

    const question = within(dialog).getByRole("heading", { name: "What is #ouroboros-loops for?" });

    expect(question).toHaveFocus();

    fireEvent.keyDown(question, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("binds, says so, and the page behind it draws the channel — and the head's Open link", async () => {
    const answer = deferred<unknown>();
    bindChannel.mockReturnValueOnce(answer.promise);
    const dialog = openPicker();

    choose(dialog, "ouroboros-loops");
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Loops/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Bind" }));

    // Pending on the pressed control only.
    expect(await within(dialog).findByRole("button", { name: "Binding…" })).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog).getByRole("button", { name: "Back to channels" })).not.toHaveAttribute("aria-disabled");
    expect(bindChannel).toHaveBeenCalledWith(LOOPS.id, "loops");

    await act(async () => {
      answer.resolve(channels([{ ...LOOPS, purpose: "loops", routes: ["blocking_question"] }, ...unboundChannels().slice(1)]));
    });

    expect(await within(dialog).findByRole("status")).toHaveTextContent("#ouroboros-loops is bound for Loops.");
    expect(within(dialog).getByRole("button", { name: /^#ouroboros-loops/ })).toHaveTextContent("bound for Loops");
    expect(within(dialog).queryByRole("button", { name: "Binding…" })).toBeNull();

    // The page under the dialog is the page after the bind.
    expect(screen.getByRole("region", { name: BOUND_TITLE })).toHaveTextContent("#ouroboros-loops");
    expect(screen.queryByRole("region", { name: FIRST_CHANNELS_TITLE })).toBeNull();
    expect(screen.getByRole("link", { name: "Open #ouroboros-loops ↗" })).toHaveAttribute("href", LOOPS.url);
  });
});

describe("a channel the bot is not in", () => {
  it("explains, before anything is asked, that the bot must be invited — and offers the refresh", () => {
    const dialog = openPicker();

    choose(dialog, "helios-private");

    const note = within(dialog).getByRole("note");

    expect(note).toHaveTextContent(notJoinedNote(PRIVATE));
    expect(note).toHaveTextContent("/invite @Ouroboros");
    expect(note).toHaveTextContent("This is a private channel");
    expect(within(note).getByRole("button", { name: "Refresh from Slack" })).toBeInTheDocument();
    expect(bindChannel).not.toHaveBeenCalled();
    expect(refreshChannels).not.toHaveBeenCalled();
  });

  it("says nothing of the kind for a channel the bot is in", () => {
    const dialog = openPicker();

    choose(dialog, "ouroboros-loops");

    expect(within(dialog).queryByRole("note")).toBeNull();
  });

  it("shows the service's own sentence when Bind is pressed anyway and refused — and no spinner remains", async () => {
    bindChannel.mockResolvedValueOnce({ error: NOT_JOINED_MESSAGE });
    const dialog = openPicker();

    choose(dialog, "helios-private");
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Alerts/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Bind" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(NOT_JOINED_MESSAGE);
    await settle();

    // An explanation, not a spinner: nothing is pending, and Bind is a button again.
    expect(within(dialog).queryByRole("button", { name: "Binding…" })).toBeNull();
    expect(within(dialog).queryByText("Binding…")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Bind" })).not.toHaveAttribute("aria-disabled");
    expect(bindChannel).toHaveBeenCalledWith(PRIVATE.id, "alerts");
    // Still on the channel, with the way to fix it in view; nothing was bound.
    expect(within(dialog).getByRole("heading", { name: "What is #helios-private for?" })).toBeInTheDocument();
    expect(within(dialog).getByRole("note")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: FIRST_CHANNELS_TITLE })).toBeInTheDocument();
  });

  it("says so, and stops, when the bind never reached the service", async () => {
    bindChannel.mockRejectedValueOnce(new TypeError("fetch failed"));
    const dialog = openPicker();

    choose(dialog, "ouroboros-loops");
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Loops/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Bind" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(BIND_FAILED);
    await settle();
    expect(within(dialog).getByRole("button", { name: "Bind" })).not.toHaveAttribute("aria-disabled");
  });

  it("re-checks after the invite: Refresh from Slack lists it as joined, and the explanation goes", async () => {
    refreshChannels.mockResolvedValueOnce(
      channels([...unboundChannels().slice(0, 2), { ...PRIVATE, joined: true, memberCount: 3 }], {
        refreshedAt: CHATOPS_READ_AT,
      }),
    );
    const dialog = openPicker();

    choose(dialog, "helios-private");
    fireEvent.click(within(within(dialog).getByRole("note")).getByRole("button", { name: "Refresh from Slack" }));

    await vi.waitFor(() => expect(within(dialog).queryByRole("note")).toBeNull());
    expect(refreshChannels).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveTextContent("private · 3 members · bot is a member");
    expect(within(dialog).getByRole("heading", { name: "What is #helios-private for?" })).toBeInTheDocument();
  });
});

describe("Refresh from Slack", () => {
  it("re-lists the channels: only its own control says so, and the list is the answer", async () => {
    const answer = deferred<unknown>();
    refreshChannels.mockReturnValueOnce(answer.promise);
    const dialog = openPicker();

    fireEvent.click(within(dialog).getByRole("button", { name: "Refresh from Slack" }));

    expect(await within(dialog).findByRole("button", { name: "Refreshing…" })).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog).getByRole("button", { name: "Done" })).not.toHaveAttribute("aria-disabled");

    await act(async () => {
      answer.resolve(channels([...unboundChannels(), channel("new-channel", { memberCount: 2 })], { refreshedAt: CHATOPS_READ_AT }));
    });

    expect(await within(dialog).findByRole("button", { name: /^#new-channel/ })).toHaveTextContent("2 members");
    expect(within(dialog).getByRole("button", { name: "Refresh from Slack" })).not.toHaveAttribute("aria-disabled");
    expect(dialog).toHaveTextContent("Listed from Slack 0s ago.");
  });

  it("prints Slack's refusal in the service's words", async () => {
    refreshChannels.mockResolvedValueOnce({ error: "Slack refused to list the channels (ratelimited)." });
    const dialog = openPicker(channels([]));

    fireEvent.click(within(dialog).getByRole("button", { name: "Refresh from Slack" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Slack refused to list the channels (ratelimited).",
    );
    await settle();
    expect(within(dialog).getByRole("button", { name: "Refresh from Slack" })).not.toHaveAttribute("aria-disabled");
  });

  it("says so when the refresh never reached the service", async () => {
    refreshChannels.mockRejectedValueOnce(new TypeError("fetch failed"));
    const dialog = openPicker();

    fireEvent.click(within(dialog).getByRole("button", { name: "Refresh from Slack" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(REFRESH_FAILED);
  });
});

describe("Unbind, in the picker", () => {
  it("is offered on a bound channel only, and takes its purpose away", async () => {
    unbindChannel.mockResolvedValueOnce(
      channels([boundChannelList()[0]!, { ...boundChannelList()[1]!, purpose: null, routes: [] }, ...boundChannelList().slice(2)]),
    );
    const dialog = openPicker(channels(boundChannelList()));

    expect(within(dialog).getAllByRole("button", { name: /^Unbind #/ })).toHaveLength(2);
    expect(within(dialog).queryByRole("button", { name: "Unbind #helios-private" })).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Unbind #helios-alerts" }));

    expect(await within(dialog).findByRole("status")).toHaveTextContent("#helios-alerts is no longer bound.");
    expect(unbindChannel).toHaveBeenCalledWith(boundChannelList()[1]!.id);
    expect(within(dialog).queryByRole("button", { name: "Unbind #helios-alerts" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: /^#helios-alerts/ })).not.toHaveTextContent("bound for");
    // And the page's list lost the row.
    expect(within(screen.getByRole("region", { name: BOUND_TITLE })).getAllByRole("listitem")).toHaveLength(1);
  });

  it("prints a refusal, and keeps the binding", async () => {
    unbindChannel.mockResolvedValueOnce({ error: "This channel still carries the blocking-question route." });
    const dialog = openPicker(channels(boundChannelList()));

    fireEvent.click(within(dialog).getByRole("button", { name: "Unbind #ouroboros-loops" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This channel still carries the blocking-question route.",
    );
    expect(within(dialog).getByRole("button", { name: /^#ouroboros-loops/ })).toHaveTextContent("bound for Loops");
  });
});
