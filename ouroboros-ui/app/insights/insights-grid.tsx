"use client";

import type { ReactNode } from "react";

import { useInsights } from "./insights-store";

/**
 * The insights page's twelve-column card grid
 * (BK.2, [#443](https://github.com/NobuData/ouroboros/issues/443)).
 *
 * Its one decision is the switch in flight: while the page on screen is another range's than
 * the one chosen, the grid is `aria-busy` and drawn quieter, so the reader sees the press
 * landed and is not handed the old range's figures as if they were the new one's.
 *
 * @param props.children The cards — the KPI row now, and every card #444–#447 adds.
 * @returns The grid.
 */
export function InsightsGrid({ children }: Readonly<{ children: ReactNode }>) {
  const { pending } = useInsights();

  return (
    <div aria-busy={pending} className={pending ? "insights__grid insights__grid--pending" : "insights__grid"}>
      {children}
    </div>
  );
}
