/**
 * Where the reader was, per route
 * ([#646](https://github.com/NobuData/ouroboros/issues/646)).
 *
 * The design system's rule (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.3): *"Scroll position
 * restored per route on back/forward; anchor deep-links scroll the pane, not the body."*
 * The browser owns exactly this behaviour for the element it restores — and the element it
 * restores is the document, which stopped scrolling when the pane became the product's one
 * scroll container (CP.1, #643). The App Router adds nothing back: on a back/forward
 * traversal it initiates no scroll at all, and its push-time reset is a write to
 * `documentElement.scrollTop`, which is a no-op against a locked body (verified against
 * `next/dist/client/components/layout-router.js` — this module exists because both halves
 * of the browser's contract moved with the scrollbar).
 *
 * So this is the memory the pane needs: positions keyed by route, and a one-shot flag that
 * says the navigation being rendered is a *traversal* — back or forward — rather than a
 * push. `app/shell/pane-restoration.tsx` is the React face that feeds both; this half is
 * **framework-free and DOM-free** for the reason `pane-scroll.ts` is framework-free: the
 * bookkeeping is the part with the interesting bugs, and it should be testable as itself.
 *
 * ### Why the key is the URL rather than the history entry
 *
 * The browser keys its own restoration by history entry, which distinguishes two visits to
 * the same page. The router does not surface an entry identity worth depending on, and the
 * specification asks for restoration *per route* — so the key is `pathname?search`, and two
 * entries for the same route share a remembered position. The trade is visible and small:
 * push A → scroll → push A again lands on the remembered position's route key but is a
 * push, so it still starts at the top; only traversals read the memory back.
 *
 * ### Why the flag is one-shot
 *
 * `popstate` fires once per traversal, before the router renders the destination. The
 * consumer is the navigation effect, which runs after. Between the two, nothing else may
 * read the flag — and a flag left set would misfile the *next* push as a traversal, which
 * is why taking it clears it.
 */

/** The remembered scroll offsets, keyed by `pathname?search`. Session-lived on purpose:
    a full reload starts a new document, and a new document starts at the top. */
const POSITIONS = new Map<string, number>();

/** Whether the navigation currently being rendered arrived by back/forward. */
let traversing = false;

/**
 * Remember where a route is scrolled to.
 *
 * Called from the pane's scroll listener — continuously rather than at departure, because
 * at departure time the pane already shows the next route. The last write before a
 * navigation is by definition the position the reader left.
 *
 * @param key The route, as `pathname?search`.
 * @param top The pane's `scrollTop`.
 */
export function rememberPanePosition(key: string, top: number): void {
  POSITIONS.set(key, top);
}

/**
 * Recall where a route was scrolled to.
 *
 * @param key The route, as `pathname?search`.
 * @returns The remembered offset, or `0` for a route never scrolled — which is also the
 *   right answer for a route never visited.
 */
export function recallPanePosition(key: string): number {
  return POSITIONS.get(key) ?? 0;
}

/**
 * Mark the navigation about to render as a back/forward traversal.
 *
 * Called from the `popstate` listener. Deliberately not called for a hash-only traversal
 * (the listener compares route keys first): there the route does not change, the
 * navigation effect will not run, and a set flag would survive to misfile the next push.
 */
export function markPaneTraversal(): void {
  traversing = true;
}

/**
 * Was this navigation a traversal? Asking consumes the answer.
 *
 * @returns `true` once per {@link markPaneTraversal}, then `false` until the next.
 */
export function takePaneTraversal(): boolean {
  const was = traversing;
  traversing = false;
  return was;
}

/**
 * Forget everything. For tests, which share module state the way two routes in one
 * session do — deliberately in the app, not deliberately in a test file.
 */
export function resetPanePositions(): void {
  POSITIONS.clear();
  traversing = false;
}
