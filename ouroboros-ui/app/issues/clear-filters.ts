/**
 * *Back to the default view* — the signal between the table's empty state and the filter bar
 * ([#120](https://github.com/NobuData/ouroboros/issues/120)).
 *
 * The *no issues match* state carries a **Clear filters** control, and what clearing means
 * is the filter bar's to decide: it navigates to the default address, publishes *no focus
 * repository* to the shell's store so the header's chip and its own select stay one choice,
 * and settles its search box — three moves that only the bar can make in the right order
 * (`app/issues/filter-bar.tsx`). The control that asks for them sits in a sibling under a
 * Server Component, so no callback can reach it; a plain link to `/issues` would leave the
 * store holding a repository the address no longer names.
 *
 * So the control says *clear the filters* and the bar, listening, does what its own
 * **Clear all** does — the shape `app/dashboard/summary-refresh.ts` gives the poll's refresh
 * for the same reason: a publisher with nothing to hand over, and a subscriber that decides
 * what the word costs. Nothing published here is data.
 *
 * **Framework-free and browser-only**, for `summary-refresh.ts`'s reasons: a module
 * singleton on the server is shared by every request the process handles, and a signal
 * published there would be one reader's press clearing the next visitor's view.
 */

import { safeWindow } from "@/app/browser";

/** Everyone waiting to be told. */
const listeners = new Set<() => void>();

/**
 * Ask for the default view.
 *
 * @returns Nothing — including on the server, where nothing may be published (the module
 *   note).
 */
export function requestClearFilters(): void {
  if (safeWindow() === undefined) return;

  // Iterated over a copy: a listener that unsubscribes on being called — an effect cleanup
  // running mid-notification — must not shorten the set being walked.
  for (const listener of [...listeners]) listener();
}

/**
 * Hear about it.
 *
 * @param listener Called with no argument each time somebody asks. Registering the same
 *   function twice registers it once.
 * @returns The way to stop listening.
 */
export function onClearFilters(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
