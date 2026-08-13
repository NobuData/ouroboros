"use client";

import { Menu, X } from "lucide-react";

import { SIDEBAR_ID } from "./regions";
import { setDrawerOpen } from "./sidebar-state";
import { useSidebar } from "./use-shell-nav";

import "./shell.css";

/**
 * The hamburger that opens the sidebar drawer below 768px
 * ([#644](https://github.com/NobuData/ouroboros/issues/644)).
 *
 * It is in the header because the sidebar is not there to be pressed: under 768px the
 * specification (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.2) takes the sidebar out of the grid
 * and floats it over the pane, which leaves the header as the only chrome still on screen. So
 * the control that opens it lives there, and the state it toggles lives in
 * `app/shell/sidebar-state.ts` — a store rather than a prop, because the two components that
 * share it are siblings the shell renders on the server.
 *
 * **Hidden above 768px by the stylesheet, not by script.** There is no drawer up there, and a
 * button that opens nothing is worse than no button; deciding it in CSS also means the right
 * answer is painted before hydration, and it is the same media query that decides where the
 * sidebar itself is.
 *
 * @returns The control.
 */
export function SidebarToggle() {
  const { drawerOpen } = useSidebar();

  return (
    <button
      type="button"
      className="shell-icon-button shell-burger"
      onClick={() => setDrawerOpen(!drawerOpen)}
      // The pair a screen reader needs to make sense of a disclosure: what state it is in,
      // and what it controls. `app/shell/regions.ts` holds the id both sides name, because a
      // reference that resolves to nothing is a button that claims to control a region which
      // does not exist.
      aria-expanded={drawerOpen}
      aria-controls={SIDEBAR_ID}
      aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
      title={drawerOpen ? "Close navigation" : "Open navigation"}
    >
      {drawerOpen ? <X size={16} aria-hidden /> : <Menu size={16} aria-hidden />}
    </button>
  );
}
