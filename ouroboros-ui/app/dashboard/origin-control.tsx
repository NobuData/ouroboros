"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DASHBOARD_PATH } from "@/app/paths";
import { DEFAULT_ORIGIN, ORIGIN_PARAM, type OriginFilter } from "@/app/origin/origin";
import { OriginSegment } from "@/app/origin/origin-segment";

import { requestSummaryRefresh } from "./summary-refresh";

/**
 * The dashboard's address for an origin: `/dashboard` for live — the default needs no parameter —
 * and `/dashboard?origin=seeded` for another.
 *
 * @param origin The chosen origin.
 * @returns The address.
 */
export function dashboardHref(origin: OriginFilter): string {
  return origin === DEFAULT_ORIGIN ? DASHBOARD_PATH : `${DASHBOARD_PATH}?${ORIGIN_PARAM}=${origin}`;
}

/**
 * The dashboard's data-origin filter (DJ.3, [#1316](https://github.com/NobuData/ouroboros/issues/1316)).
 *
 * A press is answered at once — the segment shows the new choice pressed — and then the page is
 * read again for it: the address moves (`router.replace`) and the server render re-reads, inside a
 * transition. The segment has already remembered the choice in the origin cookie, so the shell's
 * loop pills are asked again too and count the same origin. Moving to `/dashboard` from
 * `/dashboard` changes no address, so a press for live from a remembered choice refreshes instead.
 *
 * @param props.origin The origin the page was rendered for.
 * @returns The filter.
 */
export function DashboardOriginControl({ origin }: Readonly<{ origin: OriginFilter }>) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [chosen, setChosen] = useState<OriginFilter>(origin);

  return (
    <OriginSegment
      value={chosen}
      onSelect={(next) => {
        setChosen(next);
        startTransition(() => {
          const href = dashboardHref(next);

          if (`${window.location.pathname}${window.location.search}` === href) {
            router.refresh();
          } else {
            router.replace(href, { scroll: false });
          }
        });
        requestSummaryRefresh();
      }}
    />
  );
}
