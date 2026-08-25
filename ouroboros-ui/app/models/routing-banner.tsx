"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { RetryBanner } from "@/app/ui";

import { ROUTING_FAILED_HEADLINE } from "./states";

import "./models.css";

/**
 * What a refused matrix read degrades to (AA.6,
 * [#205](https://github.com/NobuData/ouroboros/issues/205)): the DASH-I.7
 * ([#86](https://github.com/NobuData/ouroboros/issues/86)) banner, on this page.
 *
 * The matrix, the rules and the spend card are one read (`app/api/routing.ts` says why), so
 * a refusal is one region and is explained **once** — here, with the service's own sentence
 * and the page's only retry — rather than once per card. The seat below says what is
 * missing and points up; it does not repeat the reason. That is the distinction the ticket
 * asks for: *routing could not be read* wears this banner and *routing is empty* wears the
 * guidance card, and the two cannot be mistaken for each other.
 *
 * The shape is the design system's (`app/ui/retry-banner.tsx`); what is this page's is the
 * headline, the placement, and the retry — `router.refresh()`, which re-runs the route's
 * Server Components and merges the result without discarding client state, so a selected
 * row and an open sheet survive a retry that succeeds.
 *
 * The page has no `Freshness` boundary and needs none: it does not poll, so there is no
 * *stale* state to hold a last good render for — the banner is drawn on the first paint that
 * failed, over the frame and the strip that did not.
 */

/**
 * The banner.
 *
 * @param props.reason What the service said, rendered as-is.
 * @returns The status region, with a retry that re-runs the route's reads.
 */
export function RoutingFailedBanner({ reason }: Readonly<{ reason: string }>) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  return (
    <RetryBanner
      className="models-failed"
      headline={ROUTING_FAILED_HEADLINE}
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
