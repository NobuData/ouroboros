"use client";

import type { PullRequestHead } from "@/app/api/pull-requests";
import { useSecondsNow } from "@/app/shell/clock";
import { RetryBanner } from "@/app/ui";

import {
  SYNC_LAG_RETRY,
  SYNC_LAG_RETRYING,
  syncLag,
  syncLagHeadline,
  syncLagReason,
} from "./states";

/**
 * The PR page's sync-lag banner ([#370](https://github.com/NobuData/ouroboros/issues/370)) —
 * said when the host has not been heard from, naming when it last was.
 *
 * DASH-I.7's box ([#86](https://github.com/NobuData/ouroboros/issues/86)) as the run console and
 * test results draw it (`app/test-results/ingest-lag-banner.tsx`). The host is the truth for a
 * PR's title, branches, counts and files, and the page's reads go on answering whether or not
 * the sync behind them does — so a stalled sync shows an older PR while looking current. The
 * banner states the last-synced time rather than letting that stand. The retry reads the page
 * again now, and the next sync clears the banner on its own.
 *
 * It reads the shared one-second clock itself, so the rest of the page does not re-render every
 * second to decide whether to draw it.
 *
 * @param props.head The PR's head.
 * @param props.readAt When the server made the page's first read, in epoch milliseconds — the
 *   clock's value for the first paint, so hydration matches.
 * @param props.onRetry Read the page again now.
 * @returns The banner, or nothing while the sync is not lagging.
 */
export function PrSyncLagBanner({
  head,
  readAt,
  onRetry,
}: Readonly<{
  head: PullRequestHead;
  readAt: number;
  onRetry: () => void;
}>) {
  const nowMs = useSecondsNow(Math.floor(readAt / 1000)) * 1000;
  const lag = syncLag(head, nowMs);

  if (lag === null) return null;

  return (
    <RetryBanner
      className="prv__banner"
      headline={syncLagHeadline(lag, head.number, nowMs)}
      onRetry={onRetry}
      reason={syncLagReason(lag)}
      retryLabel={SYNC_LAG_RETRY}
      retryingLabel={SYNC_LAG_RETRYING}
    />
  );
}
