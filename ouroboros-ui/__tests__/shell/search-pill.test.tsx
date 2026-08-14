import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderThemed } from "../helpers/theme";

/**
 * The search pill and its shortcut
 * ([#643](https://github.com/NobuData/ouroboros/issues/643), completed by
 * [#79](https://github.com/NobuData/ouroboros/issues/79)).
 *
 * This suite is about the **opening**, which is all the pill was ever about: where the control
 * is, what its key cap says, the two modifiers that reach it from anywhere, and that a
 * dismissal puts focus back where it came from. What the surface behind it *contains* is
 * `__tests__/shell/command-palette.test.tsx` — the pill names no row and asserts none.
 *
 * The one case that crosses the line is the last, and deliberately: the palette holds a query,
 * and *"a second opening starts empty"* is a claim about the pill's decision to mount it
 * conditionally rather than about anything inside it.
 *
 * There is no shell around these renders. The overlay falls back to `<body>` where there is no
 * layer, which is the same path the login screen takes, and it keeps this suite about the pill
 * rather than about the frame — `__tests__/shell/overlay.test.tsx` is where the portal and the
 * lock are asserted.
 *
 * The two stubs are the palette's, not the pill's: a router the app provides, and a Server
 * Action over a `server-only` client (`__tests__/shell/actions.test.ts` is what that does).
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

vi.mock("@/app/shell/actions", () => ({ signOutOfSession: vi.fn() }));

const { SearchPill } = await import("@/app/shell/search-pill");

/** Render the pill, the way the header does. */
function render(): void {
  renderThemed(<SearchPill />);
}

/**
 * Open the palette and hand back the pill that opened it.
 *
 * The pill is focused before it is pressed, which `fireEvent.click` does not do on its own
 * and a browser does: where focus was when the overlay opened is where the overlay puts it
 * back, so a case about focus restoration needs the press to have been a real one.
 *
 * @returns The pill.
 */
function open(): HTMLElement {
  const pill = screen.getByRole("button", { name: /Search/ });
  pill.focus();
  fireEvent.click(pill);
  return pill;
}

describe("the pill", () => {
  it("says what it opens", () => {
    render();

    const pill = screen.getByRole("button", { name: /Search/ });
    expect(pill).toHaveAttribute("aria-haspopup", "dialog");
    expect(pill).toHaveAttribute("aria-expanded", "false");
  });

  it("names the shortcut in the words of the keyboard in front of the reader", () => {
    // jsdom is not a Mac, so this is the PC spelling. The Mac one is the initial render's,
    // because the server has no keyboard to ask — see the component.
    render();

    expect(screen.getByRole("button", { name: /Search/ })).toHaveTextContent("Ctrl K");
  });

  it("reports itself open once it is", () => {
    render();

    const pill = open();

    expect(pill).toHaveAttribute("aria-expanded", "true");
  });
});

describe("opening it", () => {
  it("opens on a press", () => {
    render();

    open();

    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
  });

  it("opens on ⌘K from anywhere on the page", () => {
    render();

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
  });

  it("opens on Ctrl+K too", () => {
    // Both modifiers are accepted rather than one per platform: a Mac user on an external PC
    // keyboard presses Control, and accepting the other costs nothing.
    render();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
  });

  it("ignores a bare K, which is a letter somebody is typing", () => {
    render();

    fireEvent.keyDown(window, { key: "k" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("takes the shortcut away from the browser", () => {
    // Ctrl+K is Firefox's own search-bar shortcut. A palette that opens behind the address
    // bar is a palette nobody can type into.
    render();

    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});

describe("closing it", () => {
  it("closes on Escape, with focus back on the pill", () => {
    render();

    const pill = open();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(pill).toHaveFocus();
  });

  it("closes on a press outside the panel", () => {
    render();

    open();
    // The overlay's backdrop, which is the parent of the panel and the only other element in
    // the portal. `mousedown` rather than `click`, for the reason `app/shell/overlay.tsx`
    // gives: a drag out of the panel must not dismiss it.
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement as HTMLElement);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens empty the next time, having thrown the last query away with the palette", () => {
    // The palette is mounted only while it is open, so the reset is the unmount rather than
    // anything remembering to clear a box.
    render();

    open();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "sign" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    open();

    expect(screen.getByRole("combobox")).toHaveValue("");
  });
});

describe("what it opens", () => {
  it("is the palette, which the pill has been promising since it was drawn", () => {
    render();

    open();

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
});
