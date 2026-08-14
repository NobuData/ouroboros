"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";

import {
  EMPTY_SNAPSHOT,
  type SummaryPoll,
  type SummaryPollOptions,
  type SummarySnapshot,
  createSummaryPoll,
} from "./summary-poll";
import { onSummaryRefresh } from "./summary-refresh";

/**
 * Where the poll meets React — one store, provided once, read everywhere
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)).
 *
 * `app/dashboard/summary-poll.ts` is the loop and knows nothing about rendering; this is the
 * provider that starts one and the hook that reads it. The provider belongs at the `(app)`
 * layout because that is the one node above **both** consumers the contract names: the
 * topbar pills in the shell's header ([#78](https://github.com/NobuData/ouroboros/issues/78))
 * and the dashboard's own cards (#81–#86). Provided any lower, the pills would need a second
 * poll, and *exactly one request per interval* would become two that disagree.
 *
 * ### Why the snapshot travels by context rather than by a hook per consumer
 *
 * Each consumer could call `useSyncExternalStore` itself against a module singleton, and on
 * the server that singleton would be shared by every request the process handles — one
 * reader's numbers rendered for the next visitor, which is the failure `app/shell/nav-registry.ts`
 * refuses by guarding its publishers. A store built **inside the provider** cannot be shared
 * between requests at all, because it is built per render, so the shape that is safe is the
 * one that hands it down.
 *
 * The cost of context here is nothing: `children` arrives as an already-built element, so a
 * re-render of the provider reconciles the same element and re-renders none of the tree it
 * wraps. What re-renders is exactly the components that called {@link useDashboardSummary}.
 *
 * ### Hydration
 *
 * The server renders {@link EMPTY_SNAPSHOT} and so does the browser's first pass — the poll
 * does not start until an effect, and effects do not run during hydration — so the two
 * agree by construction rather than by luck. `app/shell/client-value.ts` sets out the same
 * argument for the values that never change.
 */

/**
 * What every consumer reads. Defaulted to {@link EMPTY_SNAPSHOT} rather than left
 * `undefined`, so a component rendered outside the provider — in a test, in a screen the
 * `(app)` layout does not wrap — reads *nothing is known yet* instead of throwing. That is
 * the honest answer for a pill: it draws nothing, which is what it does before the first
 * answer anyway.
 */
const SummaryContext = createContext<SummarySnapshot>(EMPTY_SNAPSHOT);

/** How to provide the store. `poll` is a test seam; the application passes only children. */
export interface DashboardSummaryProviderProps {
  /** The tree that reads it. */
  children: React.ReactNode;
  /**
   * Options for the poll this provider builds — a stubbed reader, a fake clock. Read once,
   * on the render that builds the poll; changing them afterwards changes nothing.
   */
  poll?: SummaryPollOptions;
}

/**
 * Start one poll and put its answers within reach of everything below.
 *
 * @param props The tree to wrap, and the test seams.
 * @returns The tree, wrapped.
 */
export function DashboardSummaryProvider({ children, poll }: DashboardSummaryProviderProps) {
  // Built **once per mount**, and by a lazy initialiser rather than a `useMemo` over the
  // prop: a poll rebuilt on a re-render would abandon the tag it holds and the interval the
  // server asked for, and would start a fresh request each time — which is exactly what a
  // `useMemo` keyed on an object prop does the first time a caller passes an inline one.
  // `useState`'s initialiser is the documented way to say *once*, and it is why the prop is
  // documented as read on the first render only.
  const [store] = useState<SummaryPoll>(() => createSummaryPoll(poll));

  useEffect(() => {
    const stopPolling = store.start();
    const stopListening = onSummaryRefresh(() => store.refresh());

    return () => {
      stopListening();
      stopPolling();
    };
  }, [store]);

  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    // The server has no poll and nothing to report. Identity-stable, because
    // `useSyncExternalStore` re-renders whenever the snapshot it is handed moves.
    () => EMPTY_SNAPSHOT,
  );

  return <SummaryContext.Provider value={snapshot}>{children}</SummaryContext.Provider>;
}

/**
 * The dashboard summary, as fresh as the last poll left it.
 *
 * @returns `{data, updatedAt, error}` — see `SummarySnapshot` for what each means and, more
 *   usefully, for which combinations of them mean *still asking*, *stale* and *never
 *   loaded*.
 */
export function useDashboardSummary(): SummarySnapshot {
  return useContext(SummaryContext);
}
