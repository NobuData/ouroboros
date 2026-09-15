"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { RetryBanner } from "@/app/ui";

import { REGISTRY_FAILED_HEADLINE } from "./view";

import "./registry.css";

/**
 * What a refused registry read degrades to (CI.6,
 * [#596](https://github.com/NobuData/ouroboros/issues/596)): the DASH-I.7
 * ([#86](https://github.com/NobuData/ouroboros/issues/86)) banner, on this page.
 *
 * The shape is the design system's (`app/ui/retry-banner.tsx`) and the arrangement is the
 * routing page's (`app/models/routing-banner.tsx`): the service's own sentence said **once**,
 * with the page's only retry beside it, and the table's seat below pointing up rather than
 * repeating either. The retry is `router.refresh()`, which re-runs the route's Server Components
 * and merges the result without discarding client state — so a selected row, an unsaved
 * inspector draft and the table `registry-freshness.tsx` is holding all survive a retry that
 * fails again.
 *
 * @param props.reason What the service said, rendered as-is.
 * @returns The status region, with a retry that re-runs the route's reads.
 */
export function RegistryFailedBanner({ reason }: Readonly<{ reason: string }>) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  return (
    <RetryBanner
      className="registry-failed"
      headline={REGISTRY_FAILED_HEADLINE}
      reason={reason}
      retrying={retrying}
      onRetry={() => {
        // The primitive never makes the control inert; this keeps a second press from stacking
        // a second transition on the first.
        if (retrying) return;
        startRetry(() => router.refresh());
      }}
    />
  );
}
