import { ShellHeader } from "./shell-header";
import { SidebarNav } from "./sidebar-nav";

import "./shell.css";

/** Where the skip link lands, and the element every page is rendered inside. */
export const CONTENT_ID = "shell-content";

/**
 * The chrome every signed-in screen shares (#41).
 *
 * Three regions, per `docs/DESIGN_SYSTEM_APP_SHELL.md` § 1: a fixed header carrying the
 * brand and the session controls, a fixed sidebar carrying the navigation, and the
 * content pane — which is the only part of the page that scrolls. The header and the
 * sidebar are grid cells of exactly the viewport's height, so they cannot move; there
 * is no `position: fixed` anywhere in the shell, and so nothing for a page to slide
 * underneath.
 *
 * The pane is focusable (`tabIndex={-1}`) only so the skip link has somewhere to put
 * focus. It is not in the tab order: a negative index is a target, not a stop.
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
      <div className="app-shell__pane" id={CONTENT_ID} tabIndex={-1}>
        <div className="app-shell__measure">{children}</div>
      </div>
    </div>
  );
}
