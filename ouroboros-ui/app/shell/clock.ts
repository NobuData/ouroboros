"use client";

import { useSyncExternalStore } from "react";

/**
 * The reader's clock, ticking, for the things on this product that measure *now*
 * ([#82](https://github.com/NobuData/ouroboros/issues/82)).
 *
 * `app/shell/client-value.ts` is the same shape of problem without the second hand: a value
 * the browser knows and the server does not, read through `useSyncExternalStore` so the
 * hydration pass matches by construction. What that store cannot do is change — it
 * subscribes to nothing, because a keyboard layout does not move mid-session. A run's
 * elapsed time does, once a second, between one poll and the next.
 *
 * ### One interval for the page, not one per row
 *
 * The store is a module singleton: the first subscriber starts the interval and the last one
 * to leave clears it. A dashboard drawing ten active runs then has one timer rather than
 * ten, every row re-renders on the same tick — so a column of durations can never show two
 * different seconds — and a page with nothing ticking on it has no timer at all.
 *
 * ### The snapshot is a whole second, and that is what makes it a snapshot
 *
 * `useSyncExternalStore` compares what {@link nowSeconds} returns with `Object.is` and
 * re-renders whenever it differs, so a snapshot in milliseconds would be a *different value
 * on every read* — a render loop rather than a clock. Seconds are also the precision
 * everything here draws: nothing in the product renders a duration finer than `1s`.
 *
 * ### Why it is not `setInterval(…, 1000)` in an effect
 *
 * That is the same three wrong answers `client-value.ts` sets out, plus a fourth: an effect
 * that starts a timer per component starts one per row, and each of them drifts against the
 * others, so two rows of the same table tick at different moments.
 */

/** Milliseconds in the unit everything here works in. */
const MS_PER_SECOND = 1000;

/**
 * Everybody currently watching the clock.
 *
 * A `Set` rather than an array so that unsubscribing is not a scan, and so a component that
 * somehow subscribed twice cannot be notified twice.
 */
const watchers = new Set<() => void>();

/** The running interval, or `undefined` when nobody is watching. */
let ticking: ReturnType<typeof setInterval> | undefined;

/** Tell everybody the second has changed. */
function announce(): void {
  // A copy, so a watcher that unsubscribes while being notified cannot change the set that
  // is being iterated.
  for (const watcher of [...watchers]) watcher();
}

/**
 * Start watching the clock.
 *
 * @param watcher What to call each second.
 * @returns The unsubscribe, which stops the interval when it was the last watcher — a timer
 *   left running after its last reader is a page that never goes idle.
 */
function subscribe(watcher: () => void): () => void {
  watchers.add(watcher);
  ticking ??= setInterval(announce, MS_PER_SECOND);

  return () => {
    watchers.delete(watcher);

    if (watchers.size === 0 && ticking !== undefined) {
      clearInterval(ticking);
      ticking = undefined;
    }
  };
}

/**
 * What time it is, to the second.
 *
 * @returns Whole seconds since the epoch, as the browser's clock reports them.
 */
function nowSeconds(): number {
  return Math.floor(Date.now() / MS_PER_SECOND);
}

/**
 * The current second, re-rendering the caller each time it changes.
 *
 * @param onServer What to use where there is no browser: the server render, and the
 *   hydration pass that has to match it. The caller passes the server's *own* reading of the
 *   clock, so the first paint is a real time rather than a placeholder — the two clocks
 *   agree to within whatever they disagree by, which is a fact about the machines rather
 *   than something a render can fix.
 * @returns Whole seconds since the epoch.
 */
export function useSecondsNow(onServer: number): number {
  return useSyncExternalStore(subscribe, nowSeconds, () => onServer);
}
