"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { RetryBanner } from "@/app/ui";

import "./providers.css";

/**
 * What a refused read degrades to on the providers page (AE.6,
 * [#232](https://github.com/NobuData/ouroboros/issues/232)): the DASH-I.7
 * ([#86](https://github.com/NobuData/ouroboros/issues/86)) banner, as
 * `app/models/routing-banner.tsx` draws it for the routing page.
 *
 * The page draws it for two states `app/providers/states.ts` decides, and never both at
 * once: the listing refused — the grid's one read it cannot survive — and the listing fine
 * but one of the four grid-wide reads beside it refused, which degrades a region of every
 * card. Either way the reason is said **once**, here, with the page's only retry, and the
 * seat or the cards below say what is missing without repeating it. That is the distinction
 * the ticket asks for: *could not be read* wears this banner and *empty* wears the guidance
 * card, and the two cannot be mistaken for each other.
 *
 * The shape is the design system's (`app/ui/retry-banner.tsx`); what is this page's is the
 * headline, the placement, and the retry — `router.refresh()`, which re-runs the route's
 * Server Components and merges the result without discarding client state, so a revealed
 * key's countdown and an open sheet survive a retry that succeeds.
 */

/** What the banner takes. */
export interface ProvidersBannerProps {
  /** The state, in words — `states.ts`'s headline for it. */
  readonly headline: string;
  /** What the service said, rendered as-is. */
  readonly reason: string;
}

/**
 * The banner.
 *
 * @param props See {@link ProvidersBannerProps}.
 * @returns The status region, with a retry that re-runs the route's reads.
 */
export function ProvidersBanner({ headline, reason }: ProvidersBannerProps) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  return (
    <RetryBanner
      className="providers-banner"
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
