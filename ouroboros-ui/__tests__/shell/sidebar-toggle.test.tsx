import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { SIDEBAR_ID } from "@/app/shell/regions";
import { setDrawerOpen, sidebarState } from "@/app/shell/sidebar-state";
import { SidebarToggle } from "@/app/shell/sidebar-toggle";

/**
 * The header's hamburger — the only way into the navigation below 768px, where the sidebar
 * has left the grid.
 *
 * That it is *hidden* above that width is the stylesheet's doing and
 * `__tests__/shell/shell-styles.test.ts` is where the rule is read; what is here is the
 * control itself: the disclosure pair a screen reader needs, and the state it writes.
 */

beforeEach(() => {
  setDrawerOpen(false);
});

describe("the sidebar toggle", () => {
  it("says what it will do and what it controls", () => {
    render(<SidebarToggle />);

    const toggle = screen.getByRole("button", { name: "Open navigation" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // The id is `app/shell/regions.ts`'s, so the reference cannot point at nothing.
    expect(toggle).toHaveAttribute("aria-controls", SIDEBAR_ID);
  });

  it("opens the drawer, and says so", () => {
    render(<SidebarToggle />);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));

    expect(sidebarState().drawerOpen).toBe(true);
    expect(screen.getByRole("button", { name: "Close navigation" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("closes it again", () => {
    render(<SidebarToggle />);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));

    expect(sidebarState().drawerOpen).toBe(false);
  });

  it("follows a drawer closed from anywhere else", () => {
    // Escape inside the drawer, a press on the ground behind it, or a link followed out of
    // it: all three write the same state, and the control has to agree with it.
    render(<SidebarToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));

    act(() => setDrawerOpen(false));

    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
