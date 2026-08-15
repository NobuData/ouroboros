"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/app/ui";

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
 * ### Two states, and the difference between them is the whole point
 *
 * - **Stale.** The reader has data on screen from a moment ago and the latest read failed. The
 *   banner says when the data is from and offers a retry; the page underneath is the last good
 *   render, untouched (`app/dashboard/freshness.tsx`). Blanking a page somebody is reading
 *   because a background refresh failed is the failure mode this exists to prevent.
 * - **Unread.** Nothing has ever been read in this session — the first paint failed. There is
 *   no data to keep, so the cards say what they could not read and this says why.
 *
 * ### Announced as a status, not as an alert
 *
 * `role="status"` puts it in the polite queue: it is a fact about the freshness of a page the
 * reader is already looking at, not an interruption. An `alert` would cut across whatever a
 * screen reader was saying to report that a *refresh* failed while the data underneath is
 * still there — which is precisely the wrong emphasis.
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
    <div className="dash-stale" role="status">
      <p className="dash-stale__text">
        <span className="dash-stale__headline">
          {readAt === null ? UNREAD_HEADLINE : staleHeadline(readAt)}
        </span>{" "}
        <span className="dash-stale__reason">{reason}</span>
      </p>

      {/*
        Neither disabled nor `aria-disabled` while the retry is in flight. The only control
        that can fix this page should never be the one thing on it that cannot be pressed —
        a reader whose retry is taking too long will press again, and that is a reasonable
        thing to want. The label reports the state instead, and the guard below keeps a second
        press from stacking a second transition on the first.
      */}
      <Button
        size="sm"
        tone="ghost"
        onClick={() => {
          if (retrying) return;
          // `router.refresh()` re-runs the route's Server Components and merges the result
          // *without discarding client state*, which is what lets the boundary above go on
          // holding the last good render across a retry that fails again. It is the same
          // property the auto-merge switch is built on.
          startRetry(() => router.refresh());
        }}
      >
        {retrying ? RETRYING_LABEL : RETRY_LABEL}
      </Button>
    </div>
  );
}

/** What the banner says when there is data on screen and it is no longer current. */
function staleHeadline(readAt: number): string {
  return `Showing data from ${clockTime(readAt)} — the latest refresh failed.`;
}

/** What it says when nothing has been read at all, so there is nothing to be stale. */
const UNREAD_HEADLINE = "The dashboard could not be read.";

/** What the control says. */
const RETRY_LABEL = "Retry";

/**
 * What it says while a retry is in flight.
 *
 * The label changes rather than a spinner appearing beside it, so the control reports its own
 * state to a screen reader without a second element to announce — and the banner's `status`
 * role reads the change out politely, which is exactly the level of interruption a retry
 * deserves.
 */
const RETRYING_LABEL = "Retrying…";
