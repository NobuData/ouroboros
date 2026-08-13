import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SearchPill } from "@/app/shell/search-pill";

/**
 * The search pill and its shortcut
 * ([#643](https://github.com/NobuData/ouroboros/issues/643)).
 *
 * Two of its three parts belong to this issue — the pill in the header's cluster, and ⌘K
 * wired to it. The third is what the palette searches, which is
 * [#79](https://github.com/NobuData/ouroboros/issues/79), so the last case here is about what
 * the panel says rather than what it finds: the design system's honesty rule (§ 3.5) asks a
 * surface that is not ready to be labelled, and "labelled" is testable.
 *
 * There is no shell around these renders, deliberately. The overlay falls back to `<body>`
 * where there is no layer, which is the same path the login screen takes, and it keeps this
 * suite about the pill rather than about the frame — `__tests__/shell/overlay.test.tsx` is
 * where the portal and the lock are asserted.
 */

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
    render(<SearchPill />);

    const pill = screen.getByRole("button", { name: /Search/ });
    expect(pill).toHaveAttribute("aria-haspopup", "dialog");
    expect(pill).toHaveAttribute("aria-expanded", "false");
  });

  it("names the shortcut in the words of the keyboard in front of the reader", () => {
    // jsdom is not a Mac, so this is the PC spelling. The Mac one is the initial render's,
    // because the server has no keyboard to ask — see the component.
    render(<SearchPill />);

    expect(screen.getByRole("button", { name: /Search/ })).toHaveTextContent("Ctrl K");
  });

  it("reports itself open once it is", () => {
    render(<SearchPill />);

    const pill = open();

    expect(pill).toHaveAttribute("aria-expanded", "true");
  });
});

describe("opening it", () => {
  it("opens on a press", () => {
    render(<SearchPill />);

    open();

    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
  });

  it("opens on ⌘K from anywhere on the page", () => {
    render(<SearchPill />);

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
  });

  it("opens on Ctrl+K too", () => {
    // Both modifiers are accepted rather than one per platform: a Mac user on an external PC
    // keyboard presses Control, and accepting the other costs nothing.
    render(<SearchPill />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
  });

  it("ignores a bare K, which is a letter somebody is typing", () => {
    render(<SearchPill />);

    fireEvent.keyDown(window, { key: "k" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("takes the shortcut away from the browser", () => {
    // Ctrl+K is Firefox's own search-bar shortcut. A palette that opens behind the address
    // bar is a palette nobody can type into.
    render(<SearchPill />);

    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});

describe("closing it", () => {
  it("closes on Escape, with focus back on the pill", () => {
    render(<SearchPill />);

    const pill = open();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(pill).toHaveFocus();
  });

  it("closes on its own dismissal", () => {
    render(<SearchPill />);

    open();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("what the panel says", () => {
  it("names the issue the palette arrives with rather than miming a result", () => {
    render(<SearchPill />);

    open();

    // Honesty (§ 3.5): a surface that is not ready is labelled, never dead — and never
    // furnished with results nobody searched for.
    expect(screen.getByRole("dialog")).toHaveTextContent("#79");
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});
