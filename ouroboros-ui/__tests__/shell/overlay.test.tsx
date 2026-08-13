import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShellOverlay } from "@/app/shell/overlay";
import { PANE_LOCKED_CLASS } from "@/app/shell/pane-scroll";
import { CONTENT_ID, OVERLAY_LAYER_ID } from "@/app/shell/regions";

/**
 * The overlay ([#643](https://github.com/NobuData/ouroboros/issues/643)) — the component the
 * shell specification's last scroll clause (§ 1.3) describes: *"Full-viewport overlays portal
 * outside the pane and lock its scroll while open."*
 *
 * Both halves of that sentence are assertable without layout, which is why they are asserted
 * here rather than left to the e2e leg: *outside the pane* is a fact about where the node
 * ends up in the document, and *locks its scroll* is a fact about the class and the scroll
 * position, not about what a browser does with them. What the browser does with them is CSS,
 * and `__tests__/shell/shell-styles.test.ts` reads the rule.
 *
 * The shell is stood up by hand — a pane and a layer with the right ids — rather than by
 * rendering `<AppShell>`, so that a case can put the pane at a scroll position and give it a
 * gutter. `regions.ts` is what both this and the real shell agree through.
 */

/** The regions built by {@link shell}, cleared after each case. */
const built: HTMLElement[] = [];

afterEach(() => {
  for (const element of built.splice(0)) element.remove();
});

/**
 * Stand up the two regions an overlay looks for.
 *
 * @param scrollTop Where the pane is scrolled to, so a case can assert it comes back.
 * @returns The pane, which is the half a case has anything to say about.
 */
function shell(scrollTop = 0): HTMLElement {
  const pane = document.createElement("div");
  pane.id = CONTENT_ID;

  let top = scrollTop;
  Object.defineProperty(pane, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(pane, "offsetWidth", { value: 815, configurable: true });
  Object.defineProperty(pane, "scrollTop", {
    get: () => top,
    set: (value: number) => {
      top = value;
    },
    configurable: true,
  });

  const layer = document.createElement("div");
  layer.id = OVERLAY_LAYER_ID;

  document.body.append(pane, layer);
  built.push(pane, layer);

  return pane;
}

describe("an overlay that is closed", () => {
  it("renders nothing at all", () => {
    shell();

    render(
      <ShellOverlay open={false} onClose={vi.fn()} label="Search">
        <p>palette</p>
      </ShellOverlay>,
    );

    // Unmounted rather than hidden: an overlay that is merely invisible is one the keyboard
    // can still reach and a screen reader can still read out.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("palette")).toBeNull();
  });

  it("leaves the pane scrolling", () => {
    const pane = shell();

    render(
      <ShellOverlay open={false} onClose={vi.fn()} label="Search">
        <p>palette</p>
      </ShellOverlay>,
    );

    expect(pane).not.toHaveClass(PANE_LOCKED_CLASS);
  });
});

describe("an overlay that is open", () => {
  it("renders outside the pane, in the shell's overlay layer", () => {
    // The whole reason the layer exists: a dialog rendered inside the pane is clipped by the
    // pane's overflow, scrolled by the pane's scrollbar, and cannot cover the header.
    const pane = shell();

    render(
      <ShellOverlay open onClose={vi.fn()} label="Search">
        <p>palette</p>
      </ShellOverlay>,
    );

    const dialog = screen.getByRole("dialog", { name: "Search" });

    expect(document.getElementById(OVERLAY_LAYER_ID)).toContainElement(dialog);
    expect(pane).not.toContainElement(dialog);
  });

  it("is a modal, and says so", () => {
    shell();

    render(
      <ShellOverlay open onClose={vi.fn()} label="Search">
        <p>palette</p>
      </ShellOverlay>,
    );

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Search");
  });

  it("holds the pane still while it is up", () => {
    const pane = shell();

    render(
      <ShellOverlay open onClose={vi.fn()} label="Search">
        <p>palette</p>
      </ShellOverlay>,
    );

    expect(pane).toHaveClass(PANE_LOCKED_CLASS);
  });

  it("gives the pane back its scroll position when it closes", () => {
    // The acceptance criterion, in one case: a reader half-way down a page opens a dialog and
    // is still half-way down it afterwards.
    const pane = shell(1_500);

    const { rerender } = render(
      <ShellOverlay open onClose={vi.fn()} label="Search">
        <p>palette</p>
      </ShellOverlay>,
    );

    rerender(
      <ShellOverlay open={false} onClose={vi.fn()} label="Search">
        <p>palette</p>
      </ShellOverlay>,
    );

    expect(pane).not.toHaveClass(PANE_LOCKED_CLASS);
    expect(pane.scrollTop).toBe(1_500);
  });

  it("releases the pane when it is unmounted rather than closed", () => {
    // A route change takes the whole subtree with it. The lock is an effect's cleanup, so it
    // lifts either way — which is why closing is not the only path that has to be tested.
    const pane = shell(400);

    const { unmount } = render(
      <ShellOverlay open onClose={vi.fn()} label="Search">
        <p>palette</p>
      </ShellOverlay>,
    );

    unmount();

    expect(pane).not.toHaveClass(PANE_LOCKED_CLASS);
    expect(pane.scrollTop).toBe(400);
  });
});

describe("outside the shell", () => {
  it("still opens, with nothing to lock", () => {
    // The login screen and the onboarding wizard render outside the shell (design system § 5),
    // so there is no pane and no layer. The fallback is <body>, which is still outside both.
    render(
      <ShellOverlay open onClose={vi.fn()} label="Search">
        <p>palette</p>
      </ShellOverlay>,
    );

    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
  });
});

describe("dismissing it", () => {
  it("closes on Escape", () => {
    shell();
    const onClose = vi.fn();

    render(
      <ShellOverlay open onClose={onClose} label="Search">
        <p>palette</p>
      </ShellOverlay>,
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on a press outside the panel", () => {
    shell();
    const onClose = vi.fn();

    const { container } = render(
      <ShellOverlay open onClose={onClose} label="Search">
        <p>palette</p>
      </ShellOverlay>,
    );

    const backdrop = document.querySelector(".shell-overlay");
    expect(backdrop).not.toBeNull();
    expect(container).toBeEmptyDOMElement();

    fireEvent.mouseDown(backdrop!);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stays open on a press inside it", () => {
    // The event bubbles from the panel to the backdrop, so without the target check a press
    // on the dialog's own text would dismiss it.
    shell();
    const onClose = vi.fn();

    render(
      <ShellOverlay open onClose={onClose} label="Search">
        <p>palette</p>
      </ShellOverlay>,
    );

    fireEvent.mouseDown(screen.getByText("palette"));

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("its focus", () => {
  it("moves into the panel when it opens", () => {
    shell();

    render(
      <ShellOverlay open onClose={vi.fn()} label="Search">
        <p>palette</p>
      </ShellOverlay>,
    );

    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("goes back to whatever opened it", () => {
    shell();

    const opener = document.createElement("button");
    document.body.append(opener);
    built.push(opener);
    opener.focus();

    const { rerender } = render(
      <ShellOverlay open onClose={vi.fn()} label="Search">
        <p>palette</p>
      </ShellOverlay>,
    );

    expect(opener).not.toHaveFocus();

    rerender(
      <ShellOverlay open={false} onClose={vi.fn()} label="Search">
        <p>palette</p>
      </ShellOverlay>,
    );

    expect(opener).toHaveFocus();
  });

  it("cycles within the panel rather than walking the page behind it", () => {
    shell();

    render(
      <ShellOverlay open onClose={vi.fn()} label="Search">
        <button type="button">first</button>
        <button type="button">last</button>
      </ShellOverlay>,
    );

    const first = screen.getByRole("button", { name: "first" });
    const last = screen.getByRole("button", { name: "last" });

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("keeps focus on a panel that has nothing focusable in it", () => {
    shell();

    render(
      <ShellOverlay open onClose={vi.fn()} label="Search">
        <p>palette</p>
      </ShellOverlay>,
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Tab" });

    expect(dialog).toHaveFocus();
  });
});
