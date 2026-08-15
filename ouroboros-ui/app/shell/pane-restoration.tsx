"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import {
  markPaneTraversal,
  recallPanePosition,
  rememberPanePosition,
  takePaneTraversal,
} from "./pane-position";
import { shellPane } from "./regions";

/**
 * The pane's scroll behaviour across navigations
 * ([#646](https://github.com/NobuData/ouroboros/issues/646)) — the React face of
 * `app/shell/pane-position.ts`, mounted once by the shell.
 *
 * Three rules, from the specification (§ 1.3) and the issue's acceptance criteria:
 *
 * 1. **Back and forward restore the pane's position.** A `popstate` listener marks the
 *    navigation as a traversal; the route effect below, running after the destination has
 *    rendered, reads the mark and puts the remembered offset back.
 * 2. **A push starts at the top.** The same effect, with no mark to take, resets the pane —
 *    the half of the browser's contract the App Router only performs against the document,
 *    which no longer scrolls.
 * 3. **An anchor scrolls the pane, offset for stuck chrome.** Deliberately *not* performed
 *    here. A push carrying a fragment is left alone: the router scrolls the target into
 *    view itself, native fragment navigation does the same on a full load, and both honour
 *    the `scroll-padding-top` the pane declares in `shell.css` — the offset, fed by the
 *    same measured heights the sticky chrome publishes. The one thing this component must
 *    do for that case is stay out of its way, which is the `location.hash` guard.
 *
 * ### Renders nothing, on purpose
 *
 * Like `FontScaleSync`, this is an effect wearing a component's lifecycle: it needs
 * `usePathname`/`useSearchParams` — which re-render a Client Component on every
 * navigation while a layout stays put — and it needs to mount exactly once, above every
 * route, which is what the shell is. It is a sibling of the pane rather than logic inside
 * it so the pane itself stays a Server Component.
 *
 * ### Why positions are recorded on scroll rather than at departure
 *
 * There is no departure hook that fires for every kind of navigation (`Link` clicks,
 * `router.push`, palette commands, traversals), but every one of them is preceded by the
 * same observable fact: the pane was last scrolled to where the reader left it. A passive
 * scroll listener files that continuously under the route being viewed, so whatever
 * navigation comes next, the memory is already right.
 *
 * ### The listener stays through a locked pane
 *
 * An overlay's scroll lock (`pane-scroll.ts`) restores `scrollTop` when it lifts, which
 * fires the listener and re-records the same offset — harmless, and the reason the two
 * modules need no knowledge of each other.
 */

/**
 * Keep the pane's scroll position honest across navigations. Mounted by `AppShell`,
 * inside a `Suspense` boundary — `useSearchParams` requires one of any client component
 * rendered during prerender.
 *
 * @returns Nothing; the work is in the effects.
 */
export function PaneRestoration() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const key = search === "" ? pathname : `${pathname}?${search}`;

  /**
   * The route the pane is currently showing, readable from listeners without re-binding
   * them per navigation. Written by the route effect below, which is what keeps a scroll
   * fired *after* a navigation filed under the new route rather than the one departed.
   */
  const keyRef = useRef(key);

  useEffect(() => {
    const pane = shellPane();
    if (pane === null) return;

    const record = () => rememberPanePosition(keyRef.current, pane.scrollTop);

    const traversed = () => {
      // `location` already names the destination when popstate fires. A hash-only
      // traversal keeps the route key, so the route effect will not run — marking it
      // would leave the flag standing to misfile the next push as a traversal.
      if (window.location.pathname + window.location.search !== keyRef.current) {
        markPaneTraversal();
      }
    };

    pane.addEventListener("scroll", record, { passive: true });
    window.addEventListener("popstate", traversed);

    return () => {
      pane.removeEventListener("scroll", record);
      window.removeEventListener("popstate", traversed);
    };
  }, []);

  useEffect(() => {
    keyRef.current = key;

    const pane = shellPane();
    if (pane === null) return;

    if (takePaneTraversal()) {
      // Runs after the destination committed, so the pane is tall enough to take the
      // offset back. A destination still streaming below a Suspense boundary may clamp
      // this to what has arrived — the remembered value stays filed either way.
      pane.scrollTop = recallPanePosition(key);
    } else if (window.location.hash === "") {
      pane.scrollTop = 0;
    }
  }, [key]);

  return null;
}
