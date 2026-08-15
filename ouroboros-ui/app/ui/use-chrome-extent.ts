"use client";

import { type RefObject, useEffect, useRef } from "react";

import { publishChromeExtent } from "./chrome";

/**
 * `app/ui/chrome.ts`, met by React ([#646](https://github.com/NobuData/ouroboros/issues/646)).
 *
 * The one place the publishing mechanism meets a component's lifecycle, the way
 * `app/shell/use-shell-nav.ts` is the one place the sidebar's stores meet one: the sticky
 * primitives attach the returned ref to their root, and the height is published for as long
 * as they are mounted and withdrawn when they are not.
 *
 * An effect rather than a layout effect, deliberately. The published height positions the
 * *next* layer of chrome down, so the cost of measuring a paint late is one frame of a bar
 * sitting a few pixels high on first mount — invisible in practice, because the bar and the
 * measurement arrive in the same frame burst. A layout effect would close even that, but a
 * `"use client"` component is still rendered on the server, where React warns on layout
 * effects for exactly this kind of use; a warning on every server render is a higher price
 * than a frame nobody can see.
 */

/**
 * Publish the referenced element's height under `property` while it is mounted.
 *
 * @param property Which chrome fact the element owns — one of the two properties
 *   `app/ui/chrome.ts` names.
 * @returns The ref to attach to the sticky element being measured.
 * @typeParam T The element the ref will hold.
 */
export function useChromeExtent<T extends HTMLElement>(property: string): RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const chrome = ref.current;
    if (chrome === null) return;

    return publishChromeExtent(chrome, property);
  }, [property]);

  return ref;
}
