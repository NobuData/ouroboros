import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderThemed } from "../helpers/theme";
import { registerCommandSource } from "@/app/shell/command-registry";
import { COMMAND_SEARCH_DELAY_MS } from "@/app/shell/use-command-actions";
import { THEME_STORAGE_KEY } from "@/app/theme";

/**
 * The ⌘K palette ([#79](https://github.com/NobuData/ouroboros/issues/79)).
 *
 * The acceptance criteria this suite is accountable for are the four that need a rendered
 * surface: *typing filters the action list*, *Enter navigates*, focus is trapped and lands
 * where a reader can type, and the registry's rows are drawn honestly — a screen nobody has
 * built is listed and labelled rather than dropped or linked to. Opening (⌘K from anywhere)
 * and closing (Esc, focus back to the pill) belong to the control that owns them and are
 * `__tests__/shell/search-pill.test.tsx`.
 *
 * It renders against the **real** registry, seeded as production seeds it — the eleven
 * navigation entries and the shell's two commands — so the assertions are about what a reader
 * actually gets rather than about fixtures. The two writes are stubbed for the same reasons
 * the account menu's suite stubs them: one is a Server Action over a `server-only` client, and
 * the other needs a router the app provides.
 */

/** Where a navigation action sent the browser. */
const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

/** The Server Action the sign-out command invokes. */
const signOutOfSession = vi.fn();

vi.mock("@/app/shell/actions", () => ({ signOutOfSession: () => signOutOfSession() }));

const { CommandPalette } = await import("@/app/shell/command-palette");

/** Told when the palette dismisses itself. */
const onClose = vi.fn();

/**
 * Render the palette, open.
 *
 * @returns The search box, which is where every case starts.
 */
function open(): HTMLElement {
  renderThemed(<CommandPalette onClose={onClose} />);
  return screen.getByRole("combobox");
}

/**
 * Type into the search box.
 *
 * @param box The search box.
 * @param query What to type.
 * @returns Nothing.
 */
function type(box: HTMLElement, query: string): void {
  fireEvent.change(box, { target: { value: query } });
}

/** The row the keyboard is pointing at, which is the one Enter would run. */
function highlighted(): HTMLElement | undefined {
  return screen.queryAllByRole("option").find((row) => row.getAttribute("aria-selected") === "true");
}

beforeEach(() => {
  push.mockClear();
  signOutOfSession.mockClear();
  onClose.mockClear();
  // The theme command writes through the #17 engine, which persists; without this the
  // second case to press it starts from the palette the first one chose.
  localStorage.removeItem(THEME_STORAGE_KEY);
});

describe("opening it", () => {
  it("puts focus in the box, so the first keystroke is part of the query", () => {
    // The overlay owns the move (`initialFocus`), because a child that took focus for itself
    // would be recorded as the element Escape has to give it back to.
    expect(open()).toHaveFocus();
  });

  it("is a dialog named for what it does", () => {
    open();

    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
  });

  it("wires the box to the list it drives", () => {
    // The combobox pattern: focus stays in the text box and the highlighted row is *named*
    // rather than focused, which is what leaves every other key to the query.
    const box = open();

    expect(box).toHaveAttribute("aria-expanded", "true");
    expect(box).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    expect(box).toHaveAttribute("aria-activedescendant", highlighted()?.id);
  });

  it("offers the product's screens and the shell's own commands", () => {
    open();

    expect(screen.getByRole("option", { name: /Go to Dashboard/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Toggle theme/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Sign out/ })).toBeInTheDocument();
  });

  it("gathers them under headings", () => {
    open();

    const navigation = screen.getByRole("group", { name: "Navigation" });

    expect(within(navigation).getByRole("option", { name: /Go to Dashboard/ })).toBeInTheDocument();
    expect(within(navigation).queryByRole("option", { name: /Sign out/ })).toBeNull();
  });

  it("says what it can and cannot answer yet", () => {
    // H.3's scope is navigation; #93 adds content search. A palette silent about that is one
    // whose empty answer to an issue number reads as "there is no such issue" (§ 3.5).
    open();

    expect(screen.getByRole("dialog")).toHaveTextContent("#93");
  });
});

describe("typing", () => {
  it("filters the list", () => {
    const box = open();

    type(box, "sign");

    expect(screen.getByRole("option", { name: /Sign out/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Go to Dashboard/ })).toBeNull();
  });

  it("finds a screen by letters scattered through its name", () => {
    const box = open();

    type(box, "gtd");

    expect(screen.getByRole("option", { name: /Go to Dashboard/ })).toBeInTheDocument();
  });

  it("finds a screen by the route it is known by", () => {
    const box = open();

    type(box, "/build-farm");

    expect(screen.getByRole("option", { name: /Go to Build Farm/ })).toBeInTheDocument();
  });

  it("moves the highlight to the best remaining match", () => {
    const box = open();

    type(box, "sign");

    expect(highlighted()).toHaveTextContent("Sign out");
  });

  it("says so when nothing matches, rather than showing an empty box", () => {
    const box = open();

    type(box, "zzzzzz");

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("dialog")).toHaveTextContent("zzzzzz");
  });
});

describe("the keyboard", () => {
  it("starts on the first row it could run", () => {
    open();

    expect(highlighted()).toHaveTextContent("Go to Dashboard");
  });

  it("moves down", () => {
    // The second runnable row, which is a second *navigation* row since #200 built
    // `/models`: an entry going live joins the palette because the palette is built from the
    // registry rather than from a list of its own (`app/shell/command-sources.ts`).
    const box = open();

    fireEvent.keyDown(box, { key: "ArrowDown" });

    expect(highlighted()).toHaveTextContent("Go to Models");
  });

  it("wraps at the ends, which is what a short list wants", () => {
    const box = open();

    fireEvent.keyDown(box, { key: "ArrowUp" });

    expect(highlighted()).toHaveTextContent("Sign out");
  });

  it("never stops on a row it could not run", () => {
    // The sidebar's rule for the same reason: stopping on a row Enter does nothing on
    // teaches a reader that the palette is broken.
    const box = open();

    for (let press = 0; press < 6; press += 1) {
      fireEvent.keyDown(box, { key: "ArrowDown" });
      expect(highlighted()).not.toHaveAttribute("aria-disabled");
    }
  });

  it("leaves Home and End to the text they belong to", () => {
    const box = open();
    fireEvent.keyDown(box, { key: "ArrowDown" });

    fireEvent.keyDown(box, { key: "Home" });

    expect(highlighted()).toHaveTextContent("Go to Models");
  });
});

describe("running an action", () => {
  it("navigates on Enter, and closes behind itself", () => {
    const box = open();

    type(box, "dashboard");
    fireEvent.keyDown(box, { key: "Enter" });

    expect(push).toHaveBeenCalledWith("/dashboard");
    expect(onClose).toHaveBeenCalled();
  });

  it("navigates on a press", () => {
    open();

    fireEvent.click(screen.getByRole("option", { name: /Go to Dashboard/ }));

    expect(push).toHaveBeenCalledWith("/dashboard");
  });

  it("keeps focus in the box when a row is pressed", () => {
    // The press is prevented on `mousedown` and acted on in `click`, so a pointer does not
    // pull focus out of a text box the reader may go on typing in.
    const box = open();

    fireEvent.mouseDown(screen.getByRole("option", { name: /Go to Issues/ }));

    expect(box).toHaveFocus();
  });

  it("changes the palette", () => {
    const box = open();

    type(box, "toggle theme");
    fireEvent.keyDown(box, { key: "Enter" });

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("signs out", () => {
    const box = open();

    type(box, "sign out");
    fireEvent.keyDown(box, { key: "Enter" });

    expect(signOutOfSession).toHaveBeenCalled();
  });

  it("does nothing at all on a row that leads nowhere", () => {
    const box = open();

    type(box, "issues");
    fireEvent.click(screen.getByRole("option", { name: /Go to Issues/ }));

    expect(push).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("a source that searches, which is what #93 registers", () => {
  /** Undo the fixture registration, whatever the case asserted. */
  let unregister: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    unregister?.();
    unregister = null;
  });

  /**
   * Register a source shaped exactly like the one J.5 will add.
   *
   * @param answer What its request resolves with — or nothing, for a request still out.
   * @returns Nothing.
   */
  function registerFinder(answer: Promise<readonly never[]> | null = null): void {
    unregister = registerCommandSource({
      id: "fixture-finder",
      sort: 30,
      find: async () =>
        answer ??
        [
          {
            id: "fixture:482",
            label: "Run 482 · helios-firmware",
            group: "Runs",
            run: () => {},
          },
        ],
    });
  }

  it("draws what it found, under its own heading, below what the shell already knew", async () => {
    registerFinder();
    const box = open();

    fireEvent.change(box, { target: { value: "482" } });
    await act(async () => void vi.advanceTimersByTime(COMMAND_SEARCH_DELAY_MS));

    await waitFor(() =>
      expect(screen.getByRole("group", { name: "Runs" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("option", { name: /Run 482/ })).toBeInTheDocument();
  });

  it("says a request is out rather than claiming nothing matched", async () => {
    // "Nothing matched" is only true once nothing is still coming.
    registerFinder(new Promise(() => {}));
    const box = open();

    fireEvent.change(box, { target: { value: "482" } });
    await act(async () => void vi.advanceTimersByTime(COMMAND_SEARCH_DELAY_MS));

    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
    expect(screen.queryByText(/Nothing here matches/)).toBeNull();
  });
});

describe("a screen nobody has built", () => {
  it("is listed, and says what it is waiting for", () => {
    // Dropping the row would answer "Issues" with no matches — a claim that there is no such
    // screen rather than the truth, which is that it is not built yet (§ 3.5).
    const box = open();

    type(box, "issues");

    expect(screen.getByRole("option", { name: /Issue intake arrives with #115/ })).toBeInTheDocument();
  });

  it("is marked, so nothing announces it as something to press", () => {
    open();

    expect(screen.getByRole("option", { name: /Go to Issues/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
