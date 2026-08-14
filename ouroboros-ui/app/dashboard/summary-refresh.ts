/**
 * *Ask again, now* — the signal, and the two moments that publish it
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)).
 *
 * The contract names two events that must not wait out the interval
 * (`docs/ARCHITECTURE.md` § 5.4):
 *
 * - **A workspace switch** ([#77](https://github.com/NobuData/ouroboros/issues/77)). The
 *   payload is scoped by the session's active organization, so the moment that changes,
 *   every number on screen belongs to a workspace the reader has left.
 * - **The auto-merge write** ([#83](https://github.com/NobuData/ouroboros/issues/83)). The
 *   switch a person just moved is in the same payload the poll reads, and a control that
 *   springs back for up to fifteen seconds reads as a control that did not work.
 *
 * ### Why a signal, and not the poll being called directly
 *
 * The publishers are in the shell — `app/shell/switch-workspace.ts` is the one write both
 * menus make — and the poll is provided at the `(app)` layout. Handing the poll down to
 * them would mean threading it through two menus and a chip that have no other interest in
 * it, and reaching *up* for it from a shared write would put a React hook inside a plain
 * async function. So a publisher says *the thing you are reading is out of date* and the
 * subscriber decides what that costs. Nothing published here is data: a signal cannot be
 * stale, and nobody has to keep two copies of anything in step.
 *
 * ### Why not read the session instead
 *
 * The provider could subscribe to BetterAuth's session and refetch whenever
 * `activeOrganizationId` moved, which would catch a switch made anywhere, including from
 * code that does not exist yet. It would not catch the auto-merge write at all — nothing
 * about the session changes there — so the signal would still be needed, and a surface with
 * two ways to say the same thing is one where a future caller picks the one that does not
 * cover their case.
 *
 * **Framework-free and browser-only**, the way `app/shell/nav-registry.ts` is: no React and
 * no `next/*`, so a shared write can publish without importing a rendering library, and
 * nothing here can be reached during a server render — see {@link requestSummaryRefresh}.
 */

import { safeWindow } from "@/app/browser";

/** Everyone waiting to be told. */
const listeners = new Set<() => void>();

/**
 * Say that the summary is out of date.
 *
 * @returns Nothing — including on the server, where a module singleton is shared by every
 *   request the process handles and a signal published into it would be one reader's
 *   workspace switch nudging the next visitor's poll. The same guard, for the same reason,
 *   as `readerScoped` in `app/shell/nav-registry.ts`.
 */
export function requestSummaryRefresh(): void {
  if (safeWindow() === undefined) return;

  // Iterated over a copy: a listener that unsubscribes on being called — which is what a
  // React effect cleanup running mid-notification looks like — must not shorten the set
  // being walked.
  for (const listener of [...listeners]) listener();
}

/**
 * Hear about it.
 *
 * @param listener Called with no argument each time somebody publishes. Registering the
 *   same function twice registers it once, so a re-render that re-subscribes cannot double
 *   the number of refetches one switch causes.
 * @returns The way to stop listening.
 */
export function onSummaryRefresh(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
