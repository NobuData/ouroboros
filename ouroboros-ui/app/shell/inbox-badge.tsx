"use client";

import { useEffect, useState } from "react";

import { setNavBadge } from "./nav-registry";
import { INBOX_BADGE_SOURCE } from "./nav-modules";
import { type InboxPollOptions, createInboxPoll, inboxBadgeCount } from "./inbox-poll";

/**
 * Publishes the sidebar **Needs You** badge from the inbox feed (#461, delivering #90 / #78).
 *
 * The badge's row (`app/shell/nav-modules.ts`) declares the source `inbox`; this is what finally
 * calls `setNavBadge` with it. One poll per signed-in shell, mounted beside the dashboard summary in
 * the `(app)` layout. It renders nothing.
 *
 * **Honest about not knowing.** Until the first answer — and after the session ends — the source is
 * withdrawn (`null`), so the badge is not drawn rather than drawn as `0`. A failed ask keeps the
 * last count it had (the poll's snapshot keeps its data), because a count a minute old is closer to
 * the truth than none; the poll retries on its own interval.
 *
 * @param props.poll Test seams for the poll — a stubbed reader, a fake clock. Read once.
 * @returns Nothing visible.
 */
export function InboxBadgePublisher({ poll }: { poll?: InboxPollOptions }) {
  // Once per mount, for `summary-store.tsx`'s reason: a poll rebuilt on a re-render would abandon
  // its interval and start a fresh request each time.
  const [store] = useState(() => createInboxPoll(poll));

  useEffect(() => {
    const publish = () => setNavBadge(INBOX_BADGE_SOURCE, inboxBadgeCount(store.snapshot()));
    const stopListening = store.subscribe(publish);
    const stopPolling = store.start();

    return () => {
      stopListening();
      stopPolling();
      setNavBadge(INBOX_BADGE_SOURCE, null);
    };
  }, [store]);

  return null;
}
