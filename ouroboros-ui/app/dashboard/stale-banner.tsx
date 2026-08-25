"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { RetryBanner } from "@/app/ui";

import { clockTime } from "./view";

/**
 * The one place a failed read is explained — and the one place it can be retried
 * ([#86](https://github.com/NobuData/ouroboros/issues/86)).
 *
 * Before this, a single refused aggregate printed the service's sentence **nine times**: on
 * four stat tiles, in four cards and in the page head's subline. That reads as nine problems
 * rather than one, it says nothing about what to do next, and it pushes the actual data off
 * the screen. The rule this component establishes is the other way round — **a card says
 * what could not be read, and this says why, once, with the way out.**
 *
 * The shape is the design system's since AA.6
 * ([#205](https://github.com/NobuData/ouroboros/issues/205)) gave the routing page the same
 * banner: `app/ui/retry-banner.tsx` draws the box, the headline, the reason and the
 * never-inert retry, and carries the two rules — said once, announced as a status — that this
 * file used to hold. What stays here is what is the dashboard's: the two headlines, the
 * placement, and the retry itself.
 *
 * ### Two states, and the difference between them is the whole point
 *
 * - **Stale.** The reader has data on screen from a moment ago and the latest read failed. The
 *   banner says when the data is from and offers a retry; the page underneath is the last good
 *   render, untouched (`app/dashboard/freshness.tsx`). Blanking a page somebody is reading
 *   because a background refresh failed is the failure mode this exists to prevent.
 * - **Unread.** Nothing has ever been read in this session — the first paint failed. There is
 *   no data to keep, so the cards say what they could not read and this says why.
 */

/** What the banner takes. */
export interface StaleBannerProps {
  /**
   * What the service said. Rendered as-is: every message in the contract's envelope is
   * written for a person and names nothing about the service's internals
   * (`app/api/errors.ts`).
   */
  readonly reason: string;
  /**
   * When the data on screen was read, in milliseconds since the epoch — or `null` when there
   * is none, which is what separates the two states above. It is the *held* reading's
   * `readAt`, never the failed render's: the failed render read nothing.
   */
  readonly readAt: number | null;
}

/**
 * The banner.
 *
 * @param props See {@link StaleBannerProps}.
 * @returns The banner, with a retry that re-runs the route's reads.
 */
export function StaleBanner({ reason, readAt }: StaleBannerProps) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  return (
    <RetryBanner
      className="dash-stale"
      headline={readAt === null ? UNREAD_HEADLINE : staleHeadline(readAt)}
      reason={reason}
      retrying={retrying}
      onRetry={() => {
        // The primitive never makes the control inert; this is the guard that keeps a second
        // press from stacking a second transition on the first.
        if (retrying) return;
        // `router.refresh()` re-runs the route's Server Components and merges the result
        // *without discarding client state*, which is what lets the boundary above go on
        // holding the last good render across a retry that fails again. It is the same
        // property the auto-merge switch is built on.
        startRetry(() => router.refresh());
      }}
    />
  );
}

/** What the banner says when there is data on screen and it is no longer current. */
function staleHeadline(readAt: number): string {
  return `Showing data from ${clockTime(readAt)} — the latest refresh failed.`;
}

/** What it says when nothing has been read at all, so there is nothing to be stale. */
const UNREAD_HEADLINE = "The dashboard could not be read.";
