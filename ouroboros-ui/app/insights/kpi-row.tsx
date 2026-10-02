"use client";

import { StatCard } from "@/app/ui";

import { useInsights } from "./insights-store";
import { KpiMethodology } from "./kpi-methodology";
import { kpiRow } from "./view";

/**
 * The insights KPI row — mockup 15's five cards
 * (BK.2, [#443](https://github.com/NobuData/ouroboros/issues/443)).
 *
 * Each card is the shared `StatCard`, and what it says is `kpiCard`'s (`app/insights/view.ts`):
 * this reads the store, so the row moves with every poll and every range switch, and maps a card
 * to the primitive's props. Its caption is the methodology button
 * (`app/insights/kpi-methodology.tsx`). The figures are drawn for **the page's own range** —
 * the window they cover — so a switch in flight never draws `30d` figures under a `7d` caption.
 *
 * The mockup's widths are `c-2 c-2 c-2 c-3 c-3`: three narrow percentages and durations, then
 * the two cards whose figures carry a unit.
 *
 * @returns The five cards, as direct children of the page's grid — none when nothing was read.
 */
export function KpiRow() {
  const { page } = useInsights();
  const cards = page === null ? [] : kpiRow(page.kpis, page.range);

  return (
    <>
      {cards.map((card, index) => (
        <StatCard
          accent={card.accent}
          caption={<KpiMethodology label={card.label} methodology={card.methodology} />}
          className={index < 3 ? "insights-kpi insights-col--2" : "insights-kpi insights-col--3"}
          delta={card.delta}
          key={card.key}
          label={card.label}
          tone={card.tone}
          value={card.value}
          valueSuffix={card.valueSuffix ?? undefined}
          valueTone={card.valueTone ?? undefined}
        />
      ))}
    </>
  );
}
