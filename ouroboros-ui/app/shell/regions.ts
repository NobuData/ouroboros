/**
 * The shell's addressable regions, named once
 * ([#643](https://github.com/NobuData/ouroboros/issues/643); the sidebar joined them with
 * [#644](https://github.com/NobuData/ouroboros/issues/644)).
 *
 * The pane, the overlay layer and the sidebar are all rendered by `app/shell/app-shell.tsx`,
 * and all are reached by things that are not its children: the skip link jumps to the pane, an
 * overlay portals into the layer from wherever it was opened, the scroll lock below has to
 * find the pane from inside a dialog three components away, and the header's hamburger has to
 * name the sidebar it opens. A React context would be the other answer, and it was weighed —
 * it would mean the frame becoming a Client Component so that a provider could wrap the
 * header, which would pull `ShellHeader` and `SidebarNav` across the boundary with it for no
 * gain. Each region is a singleton by construction, so an id each is enough, and this file is
 * the one place any of them is written down.
 *
 * **Framework-free**, in the way `app/paths.ts` and `app/shell/account.ts` are: no `next/*`,
 * no React. A Server Component renders the markup and a Client Component looks it up, so
 * anything imported here would land in both bundles.
 */

/**
 * The content pane: where the skip link lands, and the element every page is rendered inside.
 *
 * Also the element that scrolls — see {@link PANE_ATTRIBUTE} for the reason it carries an
 * attribute as well as an id.
 */
export const CONTENT_ID = "shell-content";

/**
 * The pane's marker, and the audit hook CP.5
 * ([#647](https://github.com/NobuData/ouroboros/issues/647)) enforces per route.
 *
 * An attribute rather than the id above, for exactly one reason: an id is a name and an
 * attribute is a *claim*. #647's audit asks a question of every route — "is anything making
 * the pane scroll sideways?" — and the selector it asks it through must keep meaning the
 * scroll container even if the skip link's target is ever renamed or duplicated. The check it
 * enables is one line:
 *
 * ```ts
 * const pane = page.locator(`[${PANE_ATTRIBUTE}]`);
 * expect(await pane.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
 * ```
 *
 * Which is why the pane declares its own contract instead of a spec hard-coding a class name
 * the stylesheet is free to change.
 */
export const PANE_ATTRIBUTE = "data-shell-pane";

/**
 * The overlay layer: the mount point dialogs, sheets and the command palette portal into.
 *
 * It is a sibling of the pane rather than a child, which is the whole of its job. An overlay
 * rendered *inside* the pane is an overlay the pane can scroll, clip and stack over — and one
 * that cannot cover the header, because the pane is a grid cell that does not reach it.
 */
export const OVERLAY_LAYER_ID = "shell-overlays";

/**
 * The sidebar: the navigation landmark, and what the header's hamburger opens below 768px.
 *
 * It is written down here rather than in either component because it is an *agreement between
 * them*: the toggle carries `aria-controls` naming this id, and a screen reader that follows
 * that reference to nothing announces a button that controls a region which does not exist.
 * Two files typing the same string is how that happens.
 */
export const SIDEBAR_ID = "shell-sidebar";

/**
 * Find the content pane.
 *
 * @param doc Document to search. Defaults to the ambient one; a test passes its own.
 * @returns The pane, or `null` when the caller is not inside the shell — which is a real
 *   case, not a defensive one: the login screen and the onboarding wizard render outside it
 *   (design system § 5), and an overlay opened there simply has no pane to lock.
 */
export function shellPane(doc: Document = document): HTMLElement | null {
  return doc.getElementById(CONTENT_ID);
}

/**
 * Find the overlay layer.
 *
 * @param doc Document to search. Defaults to the ambient one.
 * @returns The layer, or `null` outside the shell — where {@link shellPane} returns `null`
 *   for the same reason, and where `app/shell/overlay.tsx` falls back to `<body>`.
 */
export function shellOverlayLayer(doc: Document = document): HTMLElement | null {
  return doc.getElementById(OVERLAY_LAYER_ID);
}
