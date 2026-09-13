"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { RetryBanner } from "@/app/ui";

import "./sources.css";

/**
 * The page's retry banner — DASH-I.7's pattern
 * ([#86](https://github.com/NobuData/ouroboros/issues/86)) over the sources page's reads
 * ([#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * The primitive draws the headline, the reason and the control; this island supplies the
 * one thing a Server Component cannot — a retry that re-reads the route.
 */

/** What the banner takes. */
export interface SourcesBannerProps {
  /** The state, in words — `states.ts`'s headline for it. */
  readonly headline: string;
  /** What the service said, rendered as-is. */
  readonly reason: string;
}

/**
 * The banner.
 *
 * @param props See {@link SourcesBannerProps}.
 * @returns The banner, with its retry wired to the router.
 */
export function SourcesBanner({ headline, reason }: SourcesBannerProps) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  return (
    <RetryBanner
      className="sources-banner"
      headline={headline}
      reason={reason}
      retrying={retrying}
      onRetry={() => {
        if (retrying) return;
        startRetry(() => router.refresh());
      }}
    />
  );
}
