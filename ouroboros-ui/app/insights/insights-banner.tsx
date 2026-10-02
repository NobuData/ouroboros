"use client";

import { clockTime } from "@/app/dashboard/view";
import { RetryBanner } from "@/app/ui";

import { useInsights } from "./insights-store";
import { insightsBannerHeadline } from "./view";

/**
 * The one place a failed read of the insights page is explained, and the one place it can be
 * retried (BK.2, [#443](https://github.com/NobuData/ouroboros/issues/443)) — the farm's banner
 * (`app/farm/farm-banner.tsx`) for this page: *stale* over a page still on screen, *unread* over
 * one that never arrived, and a retry that is the poll asking now.
 *
 * @returns The banner, or nothing while the latest read is good.
 */
export function InsightsBanner() {
  const { failure, dataAt, retry, retrying } = useInsights();

  if (failure === null) return null;

  return (
    <RetryBanner
      className="insights-stale"
      headline={insightsBannerHeadline(dataAt, clockTime)}
      onRetry={retry}
      reason={failure}
      retrying={retrying}
    />
  );
}
