"use client";

import { useEffect, useState } from "react";

import { watchSections } from "./section-spy";

/**
 * `app/settings/section-spy.ts`, met by React
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)).
 *
 * The one place the watcher meets a component's lifecycle, the way `app/ui/use-chrome-extent.ts`
 * is for the sticky chrome: the tab row calls this and draws the section it returns as current.
 * Presses need no wiring — the watcher hears a press on any link to a section itself.
 *
 * ### It starts on the first section, and corrects itself after hydration
 *
 * The server cannot see the address's fragment, so the first render — the server's and the
 * browser's, which must agree — underlines the first tab. The effect then reads the fragment
 * and the pane. It is an effect of the **tab row**, deliberately: React runs a child's effects
 * before its parent's, so `PageSubnav` beneath it has already published its height by the time
 * this lands a deep-linked section, and the landing clears the chrome it is measured against.
 *
 * @param ids The sections the nav names, in its order. A stable list — a new one restarts the watch.
 * @param enabled Whether there is anything to spy on — `false` on a mounted page, whose tabs
 *   lead back to the hub rather than into the page.
 * @returns The current section — the first until the pane has been read, `undefined` when not
 *   spying.
 * @typeParam T The section ids.
 */
export function useSectionSpy<T extends string>(ids: readonly T[], enabled: boolean): T | undefined {
  const [active, setActive] = useState<T | undefined>(ids[0]);

  useEffect(() => {
    if (!enabled) return;

    return watchSections(ids, setActive).stop;
  }, [ids, enabled]);

  return enabled ? active : undefined;
}
