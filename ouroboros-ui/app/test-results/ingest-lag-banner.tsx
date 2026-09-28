"use client";

import type { TestAttempt } from "@/app/api/test-results";
import { clockTime } from "@/app/dashboard/view";
import { useSecondsNow } from "@/app/shell/clock";
import { RetryBanner } from "@/app/ui";

import {
  TESTS_LAG_REASON,
  TESTS_LAG_RETRY,
  TESTS_LAG_RETRYING,
  testsLagHeadline,
  testsLagSince,
} from "./states";

/**
 * The test-results ingest-lag banner ([#342](https://github.com/NobuData/ouroboros/issues/342))
 * — said when a running build's uploads have gone quiet, naming when a report last arrived.
 *
 * DASH-I.7's box ([#86](https://github.com/NobuData/ouroboros/issues/86)) as the run console
 * draws it (`app/runs/ingest-lag-banner.tsx`): the reads still answer, but nothing new arrives in
 * them, and nobody can tell a slow job from a dead one. So the page states the last-received time
 * rather than letting stale numbers imply freshness. The retry asks the service again now, and
 * the next report clears the banner on its own.
 *
 * It reads the shared one-second clock itself, so the rest of the page does not re-render every
 * second to decide whether to draw it.
 *
 * @param props.attempt The attempt the page reads.
 * @param props.readAt When the server made the page's first read, in epoch milliseconds — the
 *   clock's value for the first paint, so hydration matches.
 * @param props.onRetry Ask the service again now.
 * @returns The banner, or nothing while the attempt is not lagging.
 */
export function TestsIngestLagBanner({
  attempt,
  readAt,
  onRetry,
}: Readonly<{
  attempt: TestAttempt;
  readAt: number;
  onRetry: () => void;
}>) {
  const nowSeconds = useSecondsNow(Math.floor(readAt / 1000));
  const since = testsLagSince(attempt, nowSeconds * 1000);

  if (since === null) return null;

  return (
    <RetryBanner
      className="tests__banner"
      headline={testsLagHeadline(since, attempt.attemptSeq, clockTime)}
      onRetry={onRetry}
      reason={TESTS_LAG_REASON}
      retryLabel={TESTS_LAG_RETRY}
      retryingLabel={TESTS_LAG_RETRYING}
    />
  );
}
