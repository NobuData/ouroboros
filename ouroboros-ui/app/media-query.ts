"use client";

import { useCallback, useSyncExternalStore } from "react";

import { safeWindow } from "./browser";

/**
 * Asking CSS a question from React, without the two disagreeing.
 *
 * The shell's breakpoints are the specification's (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.2)
 * and they are declared once, in `app/shell/shell.css`. Almost everything that follows from
 * them is CSS's to do — the rail's width, the drawer's position — but two decisions are not,
 * because they are about *behaviour* rather than appearance: the collapse control has to know
 * which way it is about to move the sidebar, and the drawer has to know whether it is a
 * drawer at all before it traps focus.
 *
 * `useSyncExternalStore` rather than an effect that calls `setState`, for the reason
 * `app/shell/client-value.ts` sets out at length: the server has no viewport, so a value read
 * during render would disagree with the browser's and take the markup around it down with
 * it. Here the server snapshot is `false` for every query, which is the same assumption CSS
 * makes — a `max-width` query is the exception to the base rule, and the base rule is what a
 * server renders.
 */

/**
 * Whether a media query matches, kept current as the viewport changes.
 *
 * @param query The query, in CSS's own syntax — `"(max-width: 48rem)"`. A **constant**, not a
 *   value built per render: the subscription is rebuilt whenever it changes.
 * @returns `false` on the server and until hydration, then the browser's answer. A browser
 *   without `matchMedia` also answers `false`, which lands on the base stylesheet rather than
 *   on a breakpoint nobody can leave.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = safeWindow()?.matchMedia?.(query);
      list?.addEventListener("change", onChange);

      return () => list?.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => safeWindow()?.matchMedia?.(query).matches ?? false,
    () => false,
  );
}
