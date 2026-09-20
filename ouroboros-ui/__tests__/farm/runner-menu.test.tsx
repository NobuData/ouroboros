import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FarmPage } from "@/app/api/farm";
import type { FarmPollOptions } from "@/app/farm/farm-poll";
import { FarmScreen } from "@/app/farm/farm-screen";
import {
  CLOSE,
  DRAIN,
  KEEP,
  type LifecycleOutcome,
  REMOVE,
  REMOVE_CONSEQUENCES,
  UNDRAIN,
  VIEW_DETAILS,
  lifecycleConfirm,
  lifecycleDone,
  lifecycleTitle,
  removeBlocked,
} from "@/app/farm/lifecycle";
import { NO_CERTIFICATE_BEARER, runnerSheetLabel } from "@/app/farm/runner-details";
import {
  BEARER_FALLBACK_NOTE,
  DRAIN_REQUESTED,
  RUNNERS_TITLE,
  runnerActionsLabel,
} from "@/app/farm/runners";
import type { PollAnswer } from "@/app/poll";

import { ADMIN_READER, MEMBER_READER, farmReadings, seededFarm } from "../helpers/farm";
import { settle } from "../helpers/settle";

const actions = vi.hoisted(() => ({
  drainRunner: vi.fn<(id: string) => Promise<LifecycleOutcome>>(),
  undrainRunner: vi.fn<(id: string) => Promise<LifecycleOutcome>>(),
  removeRunner: vi.fn<(id: string) => Promise<LifecycleOutcome>>(),
}));

vi.mock("@/app/farm/lifecycle-actions", () => ({
  drainRunner: (id: string) => actions.drainRunner(id),
  undrainRunner: (id: string) => actions.undrainRunner(id),
  removeRunner: (id: string) => actions.removeRunner(id),
}));

// The other cards share the screen; this suite presses none of their actions.
vi.mock("@/app/farm/enroll-actions", () => ({
  mintEnrollCommand: vi.fn(),
  readEnrollmentTokens: vi.fn(),
  revokeEnrollmentToken: vi.fn(),
}));

vi.mock("@/app/farm/pool-actions", () => ({
  createPool: vi.fn(),
  deletePool: vi.fn(),
  updatePool: vi.fn(),
}));

vi.mock("@/app/farm/submit-actions", () => ({ submitBuild: vi.fn() }));

/**
 * The runner's `⋯` menu on the farm screen (#260): what it offers and to whom, the drain
 * confirmation that names the build which continues, the removal that is blocked on a connected
 * machine and names its consequences on one that is not, the details sheet, and where focus goes
 * through all of it.
 */

/** What the poll answers. Reassigned by the cases that care. */
let answer: PollAnswer<FarmPage>;

/** How many times the page has been asked for — a write asks once more. */
let reads: number;

/** A poll that answers {@link answer} and counts the asking. */
const LIVE: FarmPollOptions = {
  read: () => {
    reads += 1;

    return Promise.resolve(answer);
  },
  visible: () => true,
};

/**
 * Draw the screen.
 *
 * @param reader Who is reading. Defaults to an administrator.
 * @param page The page the first paint read.
 * @returns The render result.
 */
function draw(reader = ADMIN_READER, page: FarmPage = seededFarm()) {
  return render(<FarmScreen poll={LIVE} reader={reader} readings={farmReadings(page)} />);
}

/** The runners card. */
function card(): HTMLElement {
  return screen.getByRole("region", { name: RUNNERS_TITLE });
}

/**
 * A runner's `⋯`.
 *
 * @param name The runner's name.
 * @returns The trigger.
 */
function trigger(name: string): HTMLElement {
  return within(card()).getByRole("button", { name: runnerActionsLabel(name) });
}

/**
 * Open a runner's menu.
 *
 * @param name The runner's name.
 * @returns The menu.
 */
function openMenu(name: string): HTMLElement {
  fireEvent.click(trigger(name));

  return screen.getByRole("menu", { name: runnerActionsLabel(name) });
}

/**
 * Choose an item from a runner's menu.
 *
 * @param name The runner's name.
 * @param item The item's word.
 */
function choose(name: string, item: string): void {
  fireEvent.click(within(openMenu(name)).getByRole("menuitem", { name: item }));
}

/**
 * Press a control and let the write behind it settle.
 *
 * @param control The control.
 */
async function press(control: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(control);
    await Promise.resolve();
  });
  await settle();
}

/**
 * The seeded farm with one runner changed.
 *
 * @param name The runner's name.
 * @param change What is different about it — or `null` to take it out of the fleet.
 * @returns The page.
 */
function farmWith(name: string, change: Partial<FarmPage["runners"][number]> | null): FarmPage {
  const page = seededFarm();

  return {
    ...page,
    runners: page.runners.flatMap((runner) =>
      runner.name !== name ? [runner] : change === null ? [] : [{ ...runner, ...change }],
    ),
  };
}

/**
 * What the poll answers with a page.
 *
 * @param page The page.
 * @returns The answer.
 */
function fresh(page: FarmPage): PollAnswer<FarmPage> {
  return { state: "fresh", payload: page, etag: null, pollAfterSeconds: 10 };
}

/** The ids of the seeded runners, by name. */
const IDS = Object.fromEntries(seededFarm().runners.map((runner) => [runner.name, runner.id]));

beforeEach(() => {
  reads = 0;
  answer = fresh(seededFarm());
  for (const mock of Object.values(actions)) mock.mockReset();
  actions.drainRunner.mockResolvedValue({ ok: true, pushed: true });
  actions.undrainRunner.mockResolvedValue({ ok: true, pushed: true });
  actions.removeRunner.mockResolvedValue({ ok: true, pushed: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("what the menu offers", () => {
  it("offers an administrator Drain, Remove and View details on a machine in service", () => {
    draw();

    expect(
      within(openMenu("forge-02"))
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([DRAIN, `${REMOVE}${removeBlocked("online")}`, VIEW_DETAILS]);
  });

  it("offers Undrain on the drained machine", () => {
    draw();

    expect(within(openMenu("bigiron")).getByRole("menuitem", { name: UNDRAIN })).toBeInTheDocument();
    expect(within(screen.getByRole("menu")).queryByRole("menuitem", { name: DRAIN })).toBeNull();
  });

  it("opens one menu at a time from its own trigger, and says so on the trigger", () => {
    draw();

    expect(trigger("forge-01")).toHaveAttribute("aria-expanded", "false");
    const menu = openMenu("forge-01");

    expect(trigger("forge-01")).toHaveAttribute("aria-expanded", "true");
    expect(trigger("forge-01")).toHaveAttribute("aria-controls", menu.id);

    // Pressing the trigger again closes it.
    fireEvent.click(trigger("forge-01"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("a member session", () => {
  it("sees no action affordances: every menu holds View details alone", () => {
    draw(MEMBER_READER);

    for (const name of ["forge-01", "forge-02", "anvil-mac", "bigiron", "forge-03"]) {
      const items = within(openMenu(name)).getAllByRole("menuitem");

      // Absent rather than disabled — the issue's wording.
      expect(items.map((item) => item.textContent)).toEqual([VIEW_DETAILS]);
      fireEvent.click(trigger(name));
    }
  });

  it("can still read a runner's details — it is a read", () => {
    draw(MEMBER_READER);
    choose("forge-01", VIEW_DETAILS);

    expect(screen.getByRole("dialog", { name: runnerSheetLabel("forge-01") })).toBeInTheDocument();
  });
});

describe("the keyboard", () => {
  it("puts focus on the first item, and walks the items with the arrows", () => {
    draw();
    const menu = openMenu("forge-03");
    const [first, second, third] = within(menu).getAllByRole("menuitem");

    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "End" });
    expect(third).toHaveFocus();
    fireEvent.keyDown(third, { key: "ArrowDown" });
    expect(first).toHaveFocus();
  });

  it("reaches a blocked item with the arrows, so its reason can be read", () => {
    draw();
    const menu = openMenu("forge-02");
    const [first, blocked] = within(menu).getAllByRole("menuitem");

    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(blocked).toHaveFocus();
    expect(blocked).toHaveAccessibleDescription(removeBlocked("online"));
  });

  it("closes on Escape and hands focus back to the ⋯", () => {
    draw();
    const menu = openMenu("forge-01");

    fireEvent.keyDown(within(menu).getAllByRole("menuitem")[0], { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger("forge-01")).toHaveFocus();
  });

  it("closes on Tab from the ⋯, without swallowing the move", () => {
    // The panel is portalled to the end of the document. Focus returns to the trigger first, so
    // the browser's own Tab carries on from the row rather than from the overlay layer.
    draw();
    const menu = openMenu("forge-01");
    const tab = fireEvent.keyDown(within(menu).getAllByRole("menuitem")[0], { key: "Tab" });

    expect(tab).toBe(true); // not default-prevented
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger("forge-01")).toHaveFocus();
  });

  it("leaves the row's own arrow keys alone: a key in the menu does not move the selection", () => {
    draw();
    const menu = openMenu("forge-01");

    fireEvent.keyDown(within(menu).getAllByRole("menuitem")[0], { key: "ArrowDown" });

    // Opening the menu selected its row, as any click in a row does; the arrow did not move it.
    expect(within(card()).getAllByRole("status")[0]).toHaveTextContent(/^forge-01,/u);
  });
});

describe("dismissal from outside", () => {
  it("closes on a press elsewhere, before the press lands", () => {
    draw();
    openMenu("forge-01");

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("stays open for a press inside it", () => {
    draw();
    const menu = openMenu("forge-01");

    fireEvent.pointerDown(within(menu).getAllByRole("menuitem")[0]);

    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  /**
   * Put a runner's `⋯` somewhere on (or off) the screen. jsdom lays nothing out, so every
   * rectangle is zeros until a case says otherwise.
   *
   * @param name The runner.
   * @param top Where its trigger's top edge is, in the viewport.
   */
  function putTriggerAt(name: string, top: number): void {
    vi.spyOn(trigger(name), "getBoundingClientRect").mockReturnValue({
      top,
      bottom: top + 24,
      left: 900,
      right: 924,
      width: 24,
      height: 24,
      x: 900,
      y: top,
      toJSON: () => ({}),
    });
  }

  it("STAYS OPEN THROUGH A SCROLL, and follows its row", () => {
    // Opening the menu is itself a scroll in a real browser: the click selects and focuses the
    // row, and the table's sideways scroller nudges to reveal it a few milliseconds later. A
    // menu that closed on any scroll would never be seen — which is what a real stack showed.
    draw();
    putTriggerAt("forge-01", 300);
    const menu = openMenu("forge-01");

    expect(menu.style.getPropertyValue("--runner-menu-top")).toBe("328px");

    putTriggerAt("forge-01", 180);
    fireEvent.scroll(document.body);

    expect(screen.getByRole("menu")).toBe(menu);
    expect(menu.style.getPropertyValue("--runner-menu-top")).toBe("208px");
  });

  it("follows its row through a resize too", () => {
    draw();
    putTriggerAt("forge-01", 300);
    const menu = openMenu("forge-01");

    putTriggerAt("forge-01", 240);
    fireEvent(window, new Event("resize"));

    expect(menu.style.getPropertyValue("--runner-menu-top")).toBe("268px");
  });

  it.each([
    ["above", -200],
    ["below", 5000],
  ])("closes once its row has scrolled out of sight %s, rather than floating on without it", (_, top) => {
    draw();
    putTriggerAt("forge-01", 300);
    openMenu("forge-01");

    putTriggerAt("forge-01", top);
    fireEvent.scroll(document.body);

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens above its trigger when there is no room below", () => {
    draw();
    // Twenty pixels from the bottom of jsdom's 768-pixel viewport: the panel cannot go under.
    putTriggerAt("bigiron", window.innerHeight - 44);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function rect(
      this: HTMLElement,
    ) {
      const panel = this.getAttribute("role") === "menu";
      const top = window.innerHeight - 44;

      return {
        top: panel ? 0 : top,
        bottom: panel ? 120 : top + 24,
        left: 900,
        right: 924,
        width: 24,
        height: panel ? 120 : 24,
        x: 900,
        y: 0,
        toJSON: () => ({}),
      };
    });

    const menu = openMenu("bigiron");

    // Above: the trigger's top, less the gap, less the panel's own 120.
    expect(menu.style.getPropertyValue("--runner-menu-top")).toBe(`${window.innerHeight - 44 - 4 - 120}px`);
  });
});

describe("draining", () => {
  it("asks first, naming the build that continues, with focus on the safe answer", () => {
    draw();
    choose("forge-01", DRAIN);

    const dialog = screen.getByRole("dialog", { name: lifecycleTitle("drain", "forge-01") });

    expect(dialog).toHaveTextContent("forge-01 finishes #479 zephyr build");
    expect(dialog).toHaveTextContent("The build is not interrupted");
    expect(within(dialog).getByRole("button", { name: KEEP })).toHaveFocus();
    expect(actions.drainRunner).not.toHaveBeenCalled();
  });

  it("drains on confirm, asks for a fresh page, and says what happened", async () => {
    draw();
    await settle();
    const before = reads;

    choose("forge-01", DRAIN);
    await press(screen.getByRole("button", { name: lifecycleConfirm("drain", "forge-01", false) }));

    expect(actions.drainRunner).toHaveBeenCalledExactlyOnceWith(IDS["forge-01"]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(reads).toBeGreaterThan(before);
    expect(within(card()).getAllByRole("status")[1]).toHaveTextContent(
      lifecycleDone("drain", "forge-01", true),
    );
  });

  it("says asked rather than done when the frame did not reach the agent", async () => {
    actions.drainRunner.mockResolvedValue({ ok: true, pushed: false });
    draw();

    choose("forge-02", DRAIN);
    await press(screen.getByRole("button", { name: lifecycleConfirm("drain", "forge-02", false) }));

    expect(within(card()).getAllByRole("status")[1]).toHaveTextContent(
      lifecycleDone("drain", "forge-02", false),
    );
  });

  it("KEEPS THE CURRENT JOB RUNNING: the row still names its build, with what was asked beside the pill", async () => {
    // What the service answers the next read with: the intent written, the observation — and
    // the build — untouched. The pill is the agent's to change.
    answer = fresh(farmWith("forge-01", { desiredState: "draining" }));
    draw();

    choose("forge-01", DRAIN);
    await press(screen.getByRole("button", { name: lifecycleConfirm("drain", "forge-01", false) }));

    // The page the write asked for lands a few turns after the write itself settles.
    await within(card()).findByText(DRAIN_REQUESTED);

    const row = within(card())
      .getAllByRole("row")
      .find((candidate) => within(candidate).queryByText("forge-01") !== null) as HTMLElement;

    expect(row).toHaveTextContent("building");
    expect(row).toHaveTextContent(DRAIN_REQUESTED);
    expect(within(row).getByRole("button", { name: /^#479 / })).toBeInTheDocument();
    // …and the menu now offers the way back, not a second drain.
    expect(within(openMenu("forge-01")).getByRole("menuitem", { name: UNDRAIN })).toBeInTheDocument();
  });

  it("changes nothing when the reader backs out, and hands focus back to the ⋯", () => {
    draw();
    choose("forge-01", DRAIN);

    fireEvent.click(screen.getByRole("button", { name: KEEP }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(actions.drainRunner).not.toHaveBeenCalled();
    expect(trigger("forge-01")).toHaveFocus();
  });

  it("says why when the service refuses, and keeps the dialog to say it in", async () => {
    actions.drainRunner.mockResolvedValue({ ok: false, reason: "That runner has already been removed." });
    draw();

    choose("forge-01", DRAIN);
    await press(screen.getByRole("button", { name: lifecycleConfirm("drain", "forge-01", false) }));

    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByRole("alert")).toHaveTextContent("already been removed");
    // Nothing left to confirm: the one button closes.
    expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual([CLOSE]);
  });

  it("makes one write for two presses", async () => {
    let finish: (outcome: LifecycleOutcome) => void = () => {};
    actions.drainRunner.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    draw();

    choose("forge-01", DRAIN);
    const confirm = screen.getByRole("button", { name: lifecycleConfirm("drain", "forge-01", false) });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(actions.drainRunner).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: lifecycleConfirm("drain", "forge-01", true) })).toHaveAttribute(
      "aria-busy",
      "true",
    );

    // Resolved, so the pending write does not outlive the case.
    await act(async () => {
      finish({ ok: true, pushed: true });
      await Promise.resolve();
    });
    await settle();
  });
});

describe("undraining", () => {
  it("returns the runner to service at once — there is nothing to confirm", async () => {
    draw();
    await settle();
    const before = reads;

    fireEvent.click(trigger("bigiron"));
    await press(within(screen.getByRole("menu")).getByRole("menuitem", { name: UNDRAIN }));

    expect(actions.undrainRunner).toHaveBeenCalledExactlyOnceWith(IDS.bigiron);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(reads).toBeGreaterThan(before);
    expect(within(card()).getAllByRole("status")[1]).toHaveTextContent(
      lifecycleDone("undrain", "bigiron", true),
    );
  });

  it("opens the dialog only to say a refusal", async () => {
    actions.undrainRunner.mockResolvedValue({ ok: false, reason: "Nothing was changed." });
    draw();

    fireEvent.click(trigger("bigiron"));
    await press(within(screen.getByRole("menu")).getByRole("menuitem", { name: UNDRAIN }));

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      "Nothing was changed.",
    );
  });
});

describe("removing", () => {
  it.each(["forge-01", "forge-02", "anvil-mac"])(
    "IS BLOCKED FOR %s, WHICH IS CONNECTED — inert, with the explanation on the item",
    (name) => {
      draw();
      const blocked = within(openMenu(name)).getByRole("menuitem", { name: REMOVE });

      expect(blocked).toHaveAttribute("aria-disabled", "true");
      expect(blocked).toHaveAccessibleDescription(/removing a connected machine orphans/u);
      expect(blocked).toHaveAccessibleDescription(/Drain it first/u);

      // Pressing it does nothing: no dialog, no write, and the menu stays to be read.
      fireEvent.click(blocked);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(actions.removeRunner).not.toHaveBeenCalled();
      expect(screen.getByRole("menu")).toBeInTheDocument();
    },
  );

  it.each(["forge-03", "bigiron"])("is permitted for %s, which is offline or drained", (name) => {
    draw();

    expect(within(openMenu(name)).getByRole("menuitem", { name: REMOVE })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("names what will happen — not just are you sure — with focus on the safe answer", () => {
    draw();
    choose("forge-03", REMOVE);

    const dialog = screen.getByRole("dialog", { name: lifecycleTitle("remove", "forge-03") });

    expect(within(dialog).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      ...REMOVE_CONSEQUENCES,
    ]);
    expect(dialog).not.toHaveTextContent(/are you sure/iu);
    expect(within(dialog).getByRole("button", { name: KEEP })).toHaveFocus();
  });

  it("removes on confirm, and the row leaves with the fresh page", async () => {
    answer = fresh(farmWith("forge-03", null));
    draw();

    choose("forge-03", REMOVE);
    await press(screen.getByRole("button", { name: lifecycleConfirm("remove", "forge-03", false) }));

    expect(actions.removeRunner).toHaveBeenCalledExactlyOnceWith(IDS["forge-03"]);
    await waitFor(() => expect(within(card()).queryByText("forge-03")).toBeNull());
    expect(within(card()).getAllByRole("status")[1]).toHaveTextContent(
      lifecycleDone("remove", "forge-03", null),
    );
  });

  it("does not drop a keyboard reader on the body when the row takes its ⋯ with it", async () => {
    answer = fresh(farmWith("forge-03", null));
    draw();

    choose("forge-03", REMOVE);
    await press(screen.getByRole("button", { name: lifecycleConfirm("remove", "forge-03", false) }));

    // The confirmation handed focus to forge-03's ⋯, which unmounted with its row. The card
    // catches that and lands on the table's one tab stop.
    await waitFor(() => expect(within(card()).queryByText("forge-03")).toBeNull());

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.tagName).toBe("TR");
  });

  it("says the state the machine is now in when the service's guard refuses", async () => {
    actions.removeRunner.mockResolvedValue({
      ok: false,
      reason: "It is building now, so it was not removed.",
    });
    draw();

    choose("forge-03", REMOVE);
    await press(screen.getByRole("button", { name: lifecycleConfirm("remove", "forge-03", false) }));

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      "It is building now",
    );
    expect(within(card()).getByText("forge-03")).toBeInTheDocument();
  });
});

describe("the details sheet", () => {
  it("SHOWS THE SECURITY MODE, THE AGENT VERSION AND THE CERTIFICATE'S RENEWAL DATE", () => {
    draw();
    choose("forge-01", VIEW_DETAILS);

    const sheet = screen.getByRole("dialog", { name: runnerSheetLabel("forge-01") });

    expect(sheet).toHaveTextContent("mTLS — client certificate");
    expect(sheet).toHaveTextContent("Agent version");
    expect(sheet).toHaveTextContent("0.9.0");
    expect(sheet).toHaveTextContent("Certificate serial");
    expect(sheet).toHaveTextContent("4a110e97");
    expect(sheet).toHaveTextContent("Renews after");
    expect(sheet).toHaveTextContent("in 10d");
    expect(sheet).toHaveTextContent("82%");
  });

  it("says the bearer fallback and the missing certificate in words", () => {
    draw();
    choose("anvil-mac", VIEW_DETAILS);

    const sheet = screen.getByRole("dialog", { name: runnerSheetLabel("anvil-mac") });

    expect(sheet).toHaveTextContent("Bearer-token fallback");
    expect(sheet).toHaveTextContent(BEARER_FALLBACK_NOTE);
    expect(sheet).toHaveTextContent(NO_CERTIFICATE_BEARER);
  });

  it("follows the live page: an open sheet's figure moves when a poll lands", async () => {
    // The first paint is the server's 82%; the poll's first answer says 41%. The sheet is open
    // across the two, and it is held by the runner's id — not by a copy of the runner.
    answer = fresh(
      farmWith("forge-01", {
        telemetry: {
          cpuPct: 41,
          ramUsedBytes: 14.2e9,
          ramTotalBytes: 32e9,
          queueDepth: 2,
          sampledAt: null,
        },
      }),
    );
    draw();
    choose("forge-01", VIEW_DETAILS);

    const sheet = screen.getByRole("dialog", { name: runnerSheetLabel("forge-01") });

    await waitFor(() => expect(sheet).toHaveTextContent("41%"));
    expect(sheet).not.toHaveTextContent("82%");
  });

  it("closes when the machine leaves the fleet, rather than describing one that is gone", async () => {
    answer = fresh(farmWith("forge-03", null));
    draw();
    choose("forge-03", VIEW_DETAILS);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes, and hands focus back to the ⋯", () => {
    draw();
    choose("forge-02", VIEW_DETAILS);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger("forge-02")).toHaveFocus();
  });

  it("navigates nowhere", () => {
    const { container } = draw();
    choose("forge-01", VIEW_DETAILS);

    expect(screen.getByRole("dialog").querySelector("a")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });
});
