"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { onSummaryRefresh } from "@/app/dashboard/summary-refresh";
import { EMPTY_POLL_SNAPSHOT, type Poll, type PollSnapshot } from "@/app/poll";

/**
 * Where a poll keyed on what it asks for meets React — one loop per key, rebuilt when the key
 * moves, and none at all while there is nothing to ask for
 * ([#117](https://github.com/NobuData/ouroboros/issues/117), made generic by
 * [#119](https://github.com/NobuData/ouroboros/issues/119)).
 *
 * `app/dashboard/summary-store.tsx` builds its poll once, at the `(app)` layout, because the
 * dashboard's address never changes. The table's and the panel's do: every chip press, every
 * page turn is a new query, and every row click is a new issue, and a loop still asking for
 * the old one would draw what the key no longer names. So the poll is **keyed** — held beside
 * the key it was built for and replaced, during render, the moment the two disagree. That is
 * React's own *adjusting state when a prop changes* shape, the one the filter bar and the
 * registry table keep, and it re-renders before anything is painted rather than after, as an
 * effect would. Between the key moving and the new loop's first answer, the snapshot is empty
 * and the caller draws what it already knows for the new key.
 *
 * A poll is inert until started, so building one during a render that may be discarded costs
 * nothing; the effect below starts whichever one was committed and stops it when it is
 * replaced or the caller unmounts.
 *
 * ### A `null` key is no loop
 *
 * The panel has nothing to ask for while no row is open, and a hook cannot be called
 * conditionally — so the key may be `null`, and a `null` key holds no poll: the snapshot is
 * the empty one, `refresh` does nothing, and no request is ever made.
 *
 * ### The workspace switch
 *
 * The key does not change when the session moves to another workspace — what is polled is
 * scoped by the session's active organization, not by anything in the key — so the loop would
 * go on drawing the old workspace's answer for up to an interval. The shell publishes that
 * moment through `app/dashboard/summary-refresh.ts` (*the thing you are reading is out of
 * date*), and this hook listens for the same signal the dashboard's store does, for the same
 * reason: one word from the switch, and every poll decides for itself what it costs.
 *
 * @param key What to poll for — an address, an id — or `null` for nothing.
 * @param build How to build a poll for a key. Read on the renders that build one, so test
 *   seams closed over here are the ones in force when the loop starts.
 * @returns The latest answer, and the way to ask now.
 * @typeParam T What the poll reads.
 */
export function useKeyedPoll<T>(
  key: string | null,
  build: (key: string) => Poll<T>,
): { readonly snapshot: PollSnapshot<T>; readonly refresh: () => void } {
  const [held, setHeld] = useState<{ key: string | null; poll: Poll<T> | null }>(() => ({
    key,
    poll: key === null ? null : build(key),
  }));

  // The key moved since the poll was built. Compared during render, so the loop for the old
  // key is never read from once the new one is on screen.
  if (held.key !== key) setHeld({ key, poll: key === null ? null : build(key) });

  const { poll } = held;

  useEffect(() => {
    if (poll === null) return;

    const stopPolling = poll.start();
    const stopListening = onSummaryRefresh(() => poll.refresh());

    return () => {
      stopListening();
      stopPolling();
    };
  }, [poll]);

  const snapshot = useSyncExternalStore<PollSnapshot<T>>(
    poll === null ? subscribeToNothing : poll.subscribe,
    poll === null ? emptySnapshot : poll.snapshot,
    // The server has no poll and nothing to report. Identity-stable, because
    // `useSyncExternalStore` re-renders whenever the snapshot it is handed moves.
    emptySnapshot,
  );

  return { snapshot, refresh: poll === null ? doNothing : poll.refresh };
}

/**
 * The subscription a `null` key holds: nothing will ever change.
 *
 * @returns The way to stop, which has nothing to stop.
 */
function subscribeToNothing(): () => void {
  return doNothing;
}

/** What a `null` key's poll answers: the one empty snapshot, identity-stable. */
function emptySnapshot(): PollSnapshot<never> {
  return EMPTY_POLL_SNAPSHOT;
}

/** What a `null` key's `refresh` does. */
function doNothing(): void {}
