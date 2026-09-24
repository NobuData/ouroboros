"use client";

import type { RunConsole } from "@/app/api/runs";
import { clockTime } from "@/app/dashboard/view";
import { useSecondsNow } from "@/app/shell/clock";
import { RetryBanner } from "@/app/ui";

import {
  INGEST_LAG_REASON,
  INGEST_LAG_RETRY,
  INGEST_LAG_RETRYING,
  ingestLagHeadline,
  ingestLagSince,
} from "./states";

/**
 * The ingest-lag banner ([#314](https://github.com/NobuData/ouroboros/issues/314)) — said when a
 * live run's events have gone quiet, naming when the page last heard anything.
 *
 * DASH-I.7's box ([#86](https://github.com/NobuData/ouroboros/issues/86), `app/ui/retry-banner.tsx`)
 * over a different failure: the reads still answer, but nothing new arrives in them. Quietly
 * showing stale data is the failure mode that erodes trust fastest, so the page says when it
 * last heard from the run rather than letting a still screen imply the run is still. The retry
 * asks the service again now, and the next activity clears the banner on its own.
 *
 * It reads the shared one-second clock (`app/shell/clock.ts`) itself, so the rest of the page does
 * not re-render every second to decide whether to draw it.
 *
 * @param props.snapshot The run console snapshot.
 * @param props.newestEntryAt The newest transcript entry's `ts`, or `null` when none is held.
 * @param props.onRetry Ask the service again now.
 * @returns The banner, or nothing while the run is not lagging.
 */
export function IngestLagBanner({
  snapshot,
  newestEntryAt,
  onRetry,
}: Readonly<{
  snapshot: RunConsole;
  newestEntryAt: string | null;
  onRetry: () => void;
}>) {
  // The server's own instant for the first paint, so hydration matches (`useSecondsNow`).
  const nowSeconds = useSecondsNow(Math.floor(Date.parse(snapshot.asOf) / 1000));
  const since = ingestLagSince(snapshot, newestEntryAt, nowSeconds * 1000);

  if (since === null) return null;

  return (
    <RetryBanner
      className="run__banner"
      headline={ingestLagHeadline(since, clockTime)}
      onRetry={onRetry}
      reason={INGEST_LAG_REASON}
      retryLabel={INGEST_LAG_RETRY}
      retryingLabel={INGEST_LAG_RETRYING}
    />
  );
}
