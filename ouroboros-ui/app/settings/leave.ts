/**
 * Leaving the settings page with unsaved changes, as functions with inputs and outputs
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491), decision **S7**).
 *
 * An explicit Save has a cost the instant-apply page never pays: the reader can walk away from
 * edits that were never committed. So while anything is unsaved, leaving asks first.
 * `app/settings/leave-guard.tsx` draws the question and listens for the departures; what counts
 * as *leaving* and what the question says are decided here.
 *
 * ### What counts as leaving
 *
 * A press on a link that takes **this tab** to **another page of this application**. Not a
 * press with a modifier or a `target` — that opens the link elsewhere, and this page and its
 * edits stay where they are. Not a fragment of this page — the section nav's own anchors move
 * the pane and discard nothing. And not another origin: that is a real unload, and the
 * browser's own *leave site?* prompt (`beforeunload`) is the only thing that can hold it.
 *
 * Framework-free and pure.
 */

import { type ClickFacts, isPlainClick } from "@/app/workflows/mode-switch";

/** The parts of a link that decide where a press on it goes. */
export interface LinkFacts {
  /** The link's resolved address — an anchor element's `href` property, which is absolute. */
  readonly href: string;
  /** Its `target`. Empty when it has none. */
  readonly target: string;
  /** Whether it is a download. */
  readonly download: boolean;
}

/** Where the page is — the parts of `window.location` a comparison needs. */
export interface PageLocation {
  readonly origin: string;
  readonly pathname: string;
  readonly search: string;
}

/**
 * Where a press on a link would take this tab, when that is away from this page.
 *
 * @param click The press.
 * @param link The link pressed.
 * @param page Where the page is now.
 * @returns The destination as a path on this origin — what the router is given once the reader
 *   agrees to leave — or `null` when the press does not leave this page in this tab.
 */
export function leavingPath(click: ClickFacts, link: LinkFacts, page: PageLocation): string | null {
  if (!isPlainClick(click) || link.download) return null;
  if (link.target !== "" && link.target !== "_self") return null;

  let destination: URL;
  try {
    destination = new URL(link.href);
  } catch {
    return null;
  }

  if (destination.origin !== page.origin) return null;
  if (destination.pathname === page.pathname && destination.search === page.search) return null;

  return `${destination.pathname}${destination.search}${destination.hash}`;
}

/** The question's heading, which is also the dialog's accessible name. */
export const LEAVE_TITLE = "Leave without saving?";

/** The answer that discards the edits and goes. */
export const LEAVE_CONFIRM = "Discard changes and leave";

/** The answer that stays, with the edits as they were. */
export const LEAVE_CANCEL = "Stay on this page";

/**
 * What the question says: how much would be lost, and that it would be.
 *
 * @param pending How many fields are unsaved. Positive.
 * @returns The sentence.
 */
export function leaveBody(pending: number): string {
  const changes = pending === 1 ? "1 unsaved change" : `${String(pending)} unsaved changes`;

  return (
    `This page has ${changes}. Leaving discards ${pending === 1 ? "it" : "them"} — ` +
    "nothing is saved until you press Save changes."
  );
}
