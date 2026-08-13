import { CONTENT_ID, OVERLAY_LAYER_ID, PANE_ATTRIBUTE } from "./regions";
import { ShellHeader } from "./shell-header";
import { SidebarNav } from "./sidebar-nav";

import "./shell.css";

/**
 * Re-exported so that the shell is still one import for a caller that only wants the pane's
 * id — `app/shell/regions.ts` is where it and the overlay layer's are declared, because a
 * Client Component that needs them must not pull this whole subtree into its bundle.
 */
export { CONTENT_ID } from "./regions";

/**
 * The chrome every signed-in screen shares — the frame CP.1
 * ([#643](https://github.com/NobuData/ouroboros/issues/643)) specifies.
 *
 * Four regions, per `docs/DESIGN_SYSTEM_APP_SHELL.md` § 1: a fixed header carrying the brand,
 * the workspace and the session controls; a fixed sidebar carrying the navigation; the content
 * pane — which is the only part of the page that scrolls; and the overlay layer, which exists
 * so that a dialog can be *outside* the pane.
 *
 * ### Nothing here is `position: fixed`, and that is the design
 *
 * The header and the sidebar are grid cells of a grid that is exactly the viewport's height
 * (`height: 100%` against the `html`/`body` lock in `app/globals.css`), so they cannot move —
 * there is no offset to maintain, no z-index race with page content, and nothing for a stray
 * tall element to slide underneath. The pane is the one cell that asks to scroll, which is
 * what makes "only the content is scrollable" a property of the layout rather than a rule
 * every future page has to remember (decision S2).
 *
 * The sidebar's width is `--shell-sidebar`, declared in `shell.css` on the shell itself: the
 * grid's first column is `auto`, so it takes whatever the sidebar is. CP.2
 * ([#644](https://github.com/NobuData/ouroboros/issues/644)) moves the sidebar between its
 * three widths — expanded, the icon rail, and out of flow as a drawer — by redefining that
 * one property, and this grid did not change to allow it.
 *
 * ### The pane
 *
 * It is focusable (`tabIndex={-1}`) only so the skip link has somewhere to put focus; it is
 * not in the tab order, because a negative index is a target, not a stop. It carries
 * {@link PANE_ATTRIBUTE} as well as its id — the audit hook CP.5
 * ([#647](https://github.com/NobuData/ouroboros/issues/647)) uses to assert per route that
 * nothing has made the pane scroll sideways. `app/shell/regions.ts` says why that is an
 * attribute rather than the id.
 *
 * @param children The route being rendered, supplied by the `(app)` layout.
 * @returns The shell, wrapping the page.
 */
export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="app-shell">
      <a className="shell-skip" href={`#${CONTENT_ID}`}>
        Skip to content
      </a>
      <ShellHeader />
      <SidebarNav />
      <div
        className="app-shell__pane"
        id={CONTENT_ID}
        tabIndex={-1}
        // Spread rather than written out, so the attribute and the selector #647 audits with
        // cannot drift apart: there is one spelling of it, and it is in `regions.ts`.
        {...{ [PANE_ATTRIBUTE]: "" }}
      >
        <div className="app-shell__measure">{children}</div>
      </div>
      {/*
        The overlay layer: a sibling of the pane, and the reason a dialog can cover the header
        instead of being clipped by the grid cell it was opened from. It draws nothing itself
        (`display: contents`), so an empty layer is not a transparent sheet over the product —
        each overlay positions itself. `app/shell/overlay.tsx` is what portals into it.
      */}
      <div className="shell-overlays" id={OVERLAY_LAYER_ID} />
    </div>
  );
}
