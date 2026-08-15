"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import {
  markPaneTraversal,
  recallPanePosition,
  reconcileDeparture,
  rememberPanePosition,
  snapshotPanePosition,
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
 * 1. **Back and forward restore the pane's position.** A `popstate` listener recognises
 *    the traversal — and because the router's own popstate handler is bound first and
 *    flushes the navigation synchronously, the listener usually finds the destination
 *    *already rendered* and restores on the spot; when it does fire first, it marks the
 *    navigation and the route effect below restores after the destination commits.
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
   * The route the pane is currently showing, as *this component* last rendered it —
   * what the popstate listener compares the destination against. Written by the route
   * effect below.
   */
  const keyRef = useRef(key);

  useEffect(() => {
    const pane = shellPane();
    if (pane === null) return;

    const record = () => rememberPanePosition(keyRef.current, pane.scrollTop);

    // The reader's last press, snapshotted before anything else can hear it:
    // capture-phase `pointerdown` and `keydown`, the *first* events of an interaction —
    // not `click`, which this Next's links no longer wait for (navigation starts on the
    // press, and by the time `click` dispatches the router has already committed the
    // destination and walked it into view, scrolling the pane). That walk fires under
    // the departed route's key — the URL moves later still — and `record` above files it
    // over the reader's real position; the route effect reconciles the departure from
    // this snapshot instead. #647's restoration leg is what caught the overwrite.
    const snapshot = () =>
      snapshotPanePosition(
        window.location.pathname + window.location.search,
        pane.scrollTop,
      );

    /** Stops a restoration started below, when one is in flight. */
    let cancelRestore: (() => void) | undefined;

    const traversed = () => {
      // `location` already names the destination when popstate fires.
      if (window.location.pathname + window.location.search !== keyRef.current) {
        // This listener heard the traversal before the router rendered it: mark, and
        // let the route effect restore once the destination has committed.
        markPaneTraversal();
        return;
      }

      // The destination has *already rendered* — the router's own popstate handler was
      // bound at hydration, before this listener, and it flushes the navigation
      // synchronously, so the route effect above has run inside it and reset the pane as
      // though this were a push (observed against this Next's `layout-router` by #647's
      // restoration leg; the mark would be taken by nobody). Restore here instead — still
      // ahead of the pane's own scroll event, which dispatches asynchronously, so the
      // memory being read back has not yet been overwritten by the reset.
      //
      // A hash-only traversal also lands here (its key never changed) and keeps its own
      // scroll: the browser walks to the fragment, and the pane's offset is its business.
      if (window.location.hash === "") {
        cancelRestore?.();
        cancelRestore = restoreAsContentArrives(pane, recallPanePosition(keyRef.current));
      }
    };

    pane.addEventListener("scroll", record, { passive: true });
    window.addEventListener("popstate", traversed);
    window.addEventListener("pointerdown", snapshot, { capture: true, passive: true });
    window.addEventListener("keydown", snapshot, { capture: true, passive: true });

    return () => {
      cancelRestore?.();
      pane.removeEventListener("scroll", record);
      window.removeEventListener("popstate", traversed);
      window.removeEventListener("pointerdown", snapshot, { capture: true });
      window.removeEventListener("keydown", snapshot, { capture: true });
    };
  }, []);

  useEffect(() => {
    // The departed route's memory, put back to the reader's last press before this key
    // becomes current — see `reconcileDeparture`. On the first run the two keys are
    // equal and there is no snapshot to apply; on every later run `keyRef` still names
    // the route being left.
    reconcileDeparture(keyRef.current);
    keyRef.current = key;

    const pane = shellPane();
    if (pane === null) return;

    if (takePaneTraversal()) {
      return restoreAsContentArrives(pane, recallPanePosition(key));
    }

    if (window.location.hash === "") {
      pane.scrollTop = 0;
    }
  }, [key]);

  return null;
}

/**
 * Put a remembered offset back, and hold it while the destination settles.
 *
 * One write is not enough, twice over — both halves found by #647's restoration leg, the
 * first to drive a real traversal against the composed stack:
 *
 *   * **The pane may not be tall enough yet.** A destination whose router-cache entry has
 *     gone stale is *refetched* on traversal, so at the time this effect runs the pane
 *     may hold only a Suspense fallback — and a `scrollTop` write clamps to the height
 *     that has arrived.
 *   * **The router writes after us.** When the refetched segment commits, this Next's
 *     `layout-router` walks it into view (`scrollIntoView` — verified against
 *     `node_modules/next/dist/client/components/layout-router.js`, which its own comments
 *     say now applies on traversals too), and the nearest scrollable ancestor it walks is
 *     the pane. A restore that declared victory on its first successful write was then
 *     quietly zeroed by that commit.
 *
 * So the write is re-applied on an animation-frame loop for a short window — long enough
 * to outlast the refetch and the router's own scroll, cheap enough to not matter — with
 * one early exit that means "stop deciding for the reader": the reader scrolling on
 * their own (wheel, touch, or keys — neither this loop's writes nor the router's
 * `scrollIntoView` fire any of those).
 *
 * @param pane The scroll container, from {@link shellPane}.
 * @param target The remembered offset. `0` returns immediately — the pane starts there,
 *   the router's own walk-into-view lands there, and a loop would only wrestle with a
 *   reader who starts scrolling at once.
 * @returns The cleanup that stops the loop, for the effect above to return.
 */
function restoreAsContentArrives(pane: HTMLElement, target: number): (() => void) | undefined {
  pane.scrollTop = target;
  if (target === 0) return undefined;

  /** How long the offset is held against streaming and the router's writes, in ms. */
  const RESTORE_WINDOW_MS = 3000;

  const deadline = performance.now() + RESTORE_WINDOW_MS;
  let frame = 0;

  const stop = () => {
    cancelAnimationFrame(frame);
    for (const event of READER_SCROLL_EVENTS) window.removeEventListener(event, stop);
  };

  const attempt = () => {
    pane.scrollTop = target;
    if (performance.now() > deadline) {
      stop();
      return;
    }
    frame = requestAnimationFrame(attempt);
  };

  for (const event of READER_SCROLL_EVENTS) {
    window.addEventListener(event, stop, { passive: true });
  }
  frame = requestAnimationFrame(attempt);

  return stop;
}

/** The events that mean the *reader* is scrolling — none of which a `scrollTop` write
 *  fires, which is what lets them cancel the restoration loop without being tripped by
 *  it. */
const READER_SCROLL_EVENTS = ["wheel", "touchstart", "keydown"] as const;
