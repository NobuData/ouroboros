"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import type { BacklogListing } from "@/app/api/backlog";
import { onSummaryRefresh } from "@/app/dashboard/summary-refresh";
import { EMPTY_POLL_SNAPSHOT, type Poll, type PollSnapshot } from "@/app/poll";

import { type BacklogPollOptions, createBacklogPoll } from "./backlog-poll";

/**
 * Where the backlog's poll meets React — one loop per address, rebuilt when the address moves
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)).
 *
 * `app/dashboard/summary-store.tsx` builds its poll once, at the `(app)` layout, because the
 * dashboard's address never changes. The table's does: every chip press, every page turn is a
 * new query, and a loop still asking for the old one would draw rows the address no longer
 * names. So the poll is **keyed on the address** — held beside the address it was built for
 * and replaced, during render, the moment the two disagree. That is React's own *adjusting
 * state when a prop changes* shape, the one the filter bar and the registry table keep, and
 * it re-renders before anything is painted rather than after, as an effect would. Between the
 * address moving and the new loop's first answer, the snapshot is empty and the table draws
 * what the server rendered for the new address — which is exactly the view the reader asked
 * for.
 *
 * A poll is inert until started, so building one during a render that may be discarded costs
 * nothing; the effect below starts whichever one was committed and stops it when it is
 * replaced or the table unmounts.
 *
 * ### The workspace switch
 *
 * The address does not change when the session moves to another workspace — the listing is
 * scoped by the session's active organization, not by anything in the query string — so the
 * loop would go on drawing the old workspace's rows for up to an interval. The shell publishes
 * that moment through `app/dashboard/summary-refresh.ts` (*the thing you are reading is out of
 * date*), and this hook listens for the same signal the dashboard's store does, for the same
 * reason: one word from the switch, and every poll decides for itself what it costs.
 *
 * @param url The address to poll — `backlogUrl`'s answer for the view on screen.
 * @param options Test seams, read on the renders that build a poll; production passes none.
 * @returns The latest answer, and the way to ask now.
 */
export function useBacklogPoll(
  url: string,
  options?: BacklogPollOptions,
): { readonly snapshot: PollSnapshot<BacklogListing>; readonly refresh: () => void } {
  const [held, setHeld] = useState<{ url: string; poll: Poll<BacklogListing> }>(() => ({
    url,
    poll: createBacklogPoll(url, options),
  }));

  // The address moved since the poll was built. Compared during render, so the loop for the
  // old address is never read from once the new one is on screen.
  if (held.url !== url) setHeld({ url, poll: createBacklogPoll(url, options) });

  const { poll } = held;

  useEffect(() => {
    const stopPolling = poll.start();
    const stopListening = onSummaryRefresh(() => poll.refresh());

    return () => {
      stopListening();
      stopPolling();
    };
  }, [poll]);

  const snapshot = useSyncExternalStore(
    poll.subscribe,
    poll.snapshot,
    // The server has no poll and nothing to report. Identity-stable, because
    // `useSyncExternalStore` re-renders whenever the snapshot it is handed moves.
    () => EMPTY_POLL_SNAPSHOT,
  );

  return { snapshot, refresh: poll.refresh };
}
