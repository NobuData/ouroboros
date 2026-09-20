"use client";

import { clockTime } from "@/app/dashboard/view";
import { RetryBanner } from "@/app/ui";

import { useFarm } from "./farm-store";
import { farmBannerHeadline } from "./view";

/**
 * The one place a failed read of the farm is explained, and the one place it can be retried
 * (AI.1, [#256](https://github.com/NobuData/ouroboros/issues/256)).
 *
 * The rule is DASH-I.7's ([#86](https://github.com/NobuData/ouroboros/issues/86)) and the box is
 * the design system's (`app/ui/retry-banner.tsx`): **a tile says what could not be read, and
 * this says why, once, with the way out.** What is this screen's is the headline — *stale* over
 * a page that is still on screen, *unread* over one that never arrived (`farmBannerHeadline`) —
 * and the retry, which is **the poll asking now** rather than a `router.refresh()`: the page
 * on screen is the store's, so the store is what has to hear again. It clears itself, too — the
 * next answer that works takes the banner away without anybody pressing anything.
 *
 * @returns The banner, or nothing while the latest read is good.
 */
export function FarmBanner() {
  const { failure, dataAt, retry, retrying } = useFarm();

  if (failure === null) return null;

  return (
    <RetryBanner
      className="farm-stale"
      headline={farmBannerHeadline(dataAt, clockTime)}
      onRetry={retry}
      reason={failure}
      retrying={retrying}
    />
  );
}
