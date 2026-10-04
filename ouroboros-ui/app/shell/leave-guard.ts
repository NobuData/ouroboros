/**
 * Asking before the shell takes the reader away from unsaved work
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)).
 *
 * A page that holds edits nobody has saved — the settings hub's dirty state — has to be able to
 * say *wait* before the reader leaves it. Two kinds of departure are the browser's or the
 * page's own to see: closing the tab or reloading (`beforeunload`), and a press on a link (a
 * click the page can hear). The third kind neither can see, because it starts in the shell and
 * is not a click on a link at all: the command palette's navigation, a workspace switch from
 * either header menu, signing out. Each of those is a function call, and a function call
 * leaves no event behind to intercept.
 *
 * So the shell asks. The page registers one guard while it has something to lose; the shell's
 * three departures go through {@link requestLeave}, which runs them at once when nothing is
 * registered and hands them to the guard when something is — and the guard decides whether to
 * proceed now, later (after its own *discard and leave?*), or never.
 *
 * ### One guard, because one page is on screen
 *
 * A module-level slot rather than a list. The pane shows one route at a time, so two guards
 * registered at once would be one page's guard outliving its page — which is the bug the
 * release function exists to prevent: it clears the slot only if the slot still holds the guard
 * it was returned for, so a late cleanup cannot remove a newer page's.
 *
 * **Framework-free**, the way `app/shell/pane-scroll.ts` is: the shell's callers are click
 * handlers and the page's registration is an effect, and neither needs React to reach a
 * variable.
 */

/** Carry on with the departure the shell was about to make. */
export type Proceed = () => void;

/**
 * What a page with unsaved work registers: it is handed the departure and decides.
 *
 * Calling `proceed` — now, or after asking the reader — lets the departure happen; never
 * calling it keeps the reader on the page.
 */
export type LeaveGuard = (proceed: Proceed) => void;

/** The guard in force, or `null` when no page has anything to lose. */
let current: LeaveGuard | null = null;

/**
 * Register the page's guard for as long as it has unsaved work.
 *
 * @param guard What to ask before a shell-initiated departure.
 * @returns The release function. Idempotent, and it leaves a guard registered after this one
 *   alone — so an effect cleanup that runs late cannot disarm the page that replaced it.
 */
export function setLeaveGuard(guard: LeaveGuard): () => void {
  current = guard;

  return () => {
    if (current === guard) current = null;
  };
}

/**
 * Leave, unless a page asks otherwise.
 *
 * @param proceed The departure: a navigation, a workspace switch, a sign-out.
 */
export function requestLeave(proceed: Proceed): void {
  if (current === null) {
    proceed();
    return;
  }

  current(proceed);
}

/**
 * Whether a page is currently asking to be consulted.
 *
 * @returns `true` while a guard is registered.
 */
export function isLeaveGuarded(): boolean {
  return current !== null;
}

/**
 * Forget the guard. For tests, which share module state the way two routes in one session do.
 */
export function resetLeaveGuard(): void {
  current = null;
}
