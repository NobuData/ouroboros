import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UserMenu } from "@/app/shell/user-menu";

/**
 * The account menu.
 *
 * Its *contents* are placeholders until sessions (#33) and the profile menu (CP.3,
 * #645) land; its *interaction* is not, and is what these tests are about — because
 * that is the part CP.3 inherits rather than rewrites.
 */

/** Open the menu and hand back its two controls. */
function open() {
  const trigger = screen.getByRole("button", { name: "Account menu" });
  fireEvent.click(trigger);
  return { trigger, menu: screen.getByRole("menu") };
}

describe("the account menu", () => {
  it("starts closed, and says so on the button", () => {
    render(<UserMenu />);

    expect(screen.queryByRole("menu")).toBeNull();
    const trigger = screen.getByRole("button", { name: "Account menu" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens from the avatar and moves focus into the menu", () => {
    render(<UserMenu />);
    const { trigger } = open();

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(screen.getAllByRole("menuitem")[0]);
  });

  it("points the button at the menu it controls", () => {
    render(<UserMenu />);
    const { trigger, menu } = open();

    expect(trigger.getAttribute("aria-controls")).toBe(menu.getAttribute("id"));
  });

  it("closes again on a second press", () => {
    render(<UserMenu />);
    const { trigger } = open();

    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape and gives focus back to the avatar", () => {
    render(<UserMenu />);
    const { trigger, menu } = open();

    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    // Without this the keyboard would be left on the document body, which is the same
    // as being nowhere.
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when the pointer goes somewhere else", () => {
    render(
      <>
        <UserMenu />
        <button type="button">elsewhere</button>
      </>,
    );
    open();

    fireEvent.pointerDown(screen.getByRole("button", { name: "elsewhere" }));

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("stays open when the pointer lands inside it", () => {
    render(<UserMenu />);
    const { menu } = open();

    fireEvent.pointerDown(menu);

    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes when the keyboard tabs out, without fighting the browser for focus", () => {
    render(<UserMenu />);
    const { menu } = open();

    fireEvent.keyDown(menu, { key: "Tab" });

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("walks the items with the arrow keys, wrapping at both ends", () => {
    render(<UserMenu />);
    const { menu } = open();
    const items = screen.getAllByRole("menuitem");

    expect(items.length).toBeGreaterThan(1);
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it("jumps to the ends with Home and End", () => {
    render(<UserMenu />);
    const { menu } = open();
    const items = screen.getAllByRole("menuitem");

    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(items[items.length - 1]);

    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
  });

  it("offers the actions it will have, marked unavailable with a reason", () => {
    render(<UserMenu />);
    open();

    // Present rather than absent: a menu that omits "Sign out" until sessions exist
    // teaches the wrong shape, and a control that cannot act must say why (§ 3.5).
    for (const name of ["Workspace settings", "Sign out"]) {
      const item = screen.getByRole("menuitem", { name });
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(item).not.toBeDisabled();
      expect(item.getAttribute("title")).toMatch(/arrives? with/);
    }
  });

  it("does not claim to know who is signed in", () => {
    render(<UserMenu />);
    open();

    expect(screen.getByRole("menu")).toHaveTextContent("Not signed in");
  });
});
