import { useSyncExternalStore } from "react";

import { stageAnchorId } from "./copilot-view";

/**
 * Which stage the address is pointing at (CE.3,
 * [#567](https://github.com/NobuData/ouroboros/issues/567)) — `#stage-plan`, the anchor a
 * refused promote's findings carry (`copilot-view.ts`' `stageAnchorHref`).
 *
 * `:target` cannot be relied on for this. The findings are router links, and a fragment the
 * router enters is pushed with `history.pushState`: no `hashchange` fires and the browser does
 * not move `:target`. So this hears the three things that can change the answer — a press on a
 * link to a stage, `hashchange`, and `popstate` — and the card rings the row itself.
 *
 * A press is counted, so pressing the same finding twice brings the row back into view twice.
 */

/** The fragment the last press on a stage link named, until the address moves by itself. */
let pressed: string | null = null;

/** How many presses there have been — what makes a repeated press a new answer. */
let presses = 0;

/** What the server, and the hydrating render, see: no fragment. */
const NOTHING = "0|";

/**
 * The answer as one comparable string: the press count, then the fragment.
 *
 * @returns `3|#stage-plan`.
 */
function snapshot(): string {
  return `${presses}|${pressed ?? window.location.hash}`;
}

/**
 * Be told when the answer may have changed.
 *
 * @param listener What to call.
 * @returns The unsubscribe.
 */
function subscribe(listener: () => void): () => void {
  const onMove = (): void => {
    pressed = null;
    listener();
  };
  const onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
    const href = target?.getAttribute("href") ?? "";
    if (!href.startsWith(`#${stageAnchorId("")}`)) return;

    pressed = href;
    presses += 1;
    listener();
  };

  window.addEventListener("hashchange", onMove);
  window.addEventListener("popstate", onMove);
  // Capture, so the press is heard before a dialog that closes on it takes the link away.
  document.addEventListener("click", onClick, true);

  return () => {
    window.removeEventListener("hashchange", onMove);
    window.removeEventListener("popstate", onMove);
    document.removeEventListener("click", onClick, true);
    pressed = null;
  };
}

/** The stage the address points at. */
export interface StageTarget {
  /** The stage's node id. */
  readonly nodeId: string;
  /** Changes with every press, so an effect keyed on it runs again for a repeated one. */
  readonly stamp: string;
}

/**
 * Read a snapshot as a target.
 *
 * @param value `{presses}|{fragment}`.
 * @returns The stage it names, or `null` for a fragment that is not a stage's.
 */
export function readStageTarget(value: string): StageTarget | null {
  const fragment = value.slice(value.indexOf("|") + 1);
  if (!fragment.startsWith("#")) return null;

  let id: string;
  try {
    id = decodeURIComponent(fragment.slice(1));
  } catch {
    return null;
  }

  const prefix = stageAnchorId("");

  return id.startsWith(prefix) && id.length > prefix.length ? { nodeId: id.slice(prefix.length), stamp: value } : null;
}

/**
 * The stage the address points at, re-rendering the caller when it changes.
 *
 * @returns The target, or `null`.
 */
export function useStageTarget(): StageTarget | null {
  return readStageTarget(useSyncExternalStore(subscribe, snapshot, () => NOTHING));
}
