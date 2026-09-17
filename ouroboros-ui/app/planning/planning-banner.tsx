"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { RetryBanner } from "@/app/ui";

import "./planning.css";

/**
 * What a refused read degrades to on the planning page (AM.5,
 * [#287](https://github.com/NobuData/ouroboros/issues/287)): the DASH-I.7
 * ([#86](https://github.com/NobuData/ouroboros/issues/86)) banner, as
 * `app/sources/sources-banner.tsx` and `app/providers/providers-banner.tsx` draw it for theirs.
 *
 * ### It is why *could not be read* stopped looking like *nothing here yet*
 *
 * This page makes five reads and draws four cards, and before this issue each card printed the
 * service's own sentence into its own `EmptyState` — so a full outage put four different failure
 * messages down the page in the same treatment an empty workspace gets. Now the reason is said
 * **once**, here, with the page's only retry; each card keeps a title naming what is missing and
 * points at this banner for why (`states.ts`'s `CARD_UNREAD_NOTE`). Empty keeps the guidance card,
 * and the two can no longer be mistaken for each other.
 *
 * The shape is the design system's (`app/ui/retry-banner.tsx`); what is this page's is the
 * headline, the placement under the page head, and the retry — `router.refresh()`, which re-runs
 * the route's Server Components and merges the result without discarding client state, so a typed
 * prompt, an open epic sheet and a batch in flight all survive a retry that succeeds.
 */

/** What the banner takes. */
export interface PlanningBannerProps {
  /** The state, in words — `states.ts`'s headline for what failed. */
  readonly headline: string;
  /** What the service said, rendered as-is. */
  readonly reason: string;
}

/**
 * The banner.
 *
 * @param props See {@link PlanningBannerProps}.
 * @returns The status region, with a retry that re-runs the route's reads.
 */
export function PlanningBanner({ headline, reason }: PlanningBannerProps) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  return (
    <RetryBanner
      className="planning-banner"
      headline={headline}
      reason={reason}
      retrying={retrying}
      onRetry={() => {
        // The primitive never makes the control inert; this keeps a second press from
        // stacking a second transition on the first.
        if (retrying) return;
        startRetry(() => router.refresh());
      }}
    />
  );
}
