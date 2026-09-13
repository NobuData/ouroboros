"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { RetryBanner } from "@/app/ui";

import "./workflows.css";

/**
 * What a refused read degrades to on the studio (S.1,
 * [#147](https://github.com/NobuData/ouroboros/issues/147)): the DASH-I.7
 * ([#86](https://github.com/NobuData/ouroboros/issues/86)) banner, on this page.
 *
 * The studio makes two reads and either can fail on its own, so the banner takes its headline
 * from the screen — *the workflows could not be read* for the rail, *this workflow could not be
 * read* for the second read — and the page draws it **once**, with the service's own sentence
 * and the page's only retry, rather than once per region. The seat below says what is missing
 * and points up; it does not repeat the reason. That is the distinction the design system asks
 * for: *could not be read* wears this banner and *empty* wears the seat's own copy, and the two
 * cannot be mistaken for each other.
 *
 * The shape is the design system's (`app/ui/retry-banner.tsx`); what is this page's is the
 * placement and the retry — `router.refresh()`, which re-runs the route's Server Components
 * and merges the result without discarding client state, so an open dialog survives a retry
 * that succeeds.
 */

/**
 * The banner.
 *
 * @param props.headline The state, in words — which of the two reads failed.
 * @param props.reason What the service said, rendered as-is.
 * @returns The status region, with a retry that re-runs the route's reads.
 */
export function StudioFailedBanner({
  headline,
  reason,
}: Readonly<{ headline: string; reason: string }>) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  return (
    <RetryBanner
      className="studio-failed"
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
