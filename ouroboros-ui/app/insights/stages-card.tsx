"use client";

import { HBars } from "@/app/charts";

import { NO_STAGES, STAGES_TITLE, stagesView } from "./bars-view";
import { useInsights } from "./insights-store";
import { SeriesCard, SeriesEmptyState, SeriesSkeleton } from "./series-card";

/**
 * Mockup 15's **CYCLE TIME BY STAGE · MEDIAN** card (BK.4, [#445](https://github.com/NobuData/ouroboros/issues/445)).
 *
 * The `HBars` primitive over BJ.2's stage medians, in loop order, with the dominant stage lifted
 * and the rest receded (`stagesView`). Under it, the service's computed line — *"Implement
 * dominates the loop — the other five stages sum to 8m 20s."* — drawn only when the service had
 * one to give; nothing here adds medians up.
 *
 * Drawn for the page's own range, as every card is, and a skeleton before anything is read.
 *
 * @returns The card.
 */
export function StagesCard() {
  const { page } = useInsights();

  if (page === null) {
    return (
      <SeriesCard busy tag={null} title={STAGES_TITLE} width="third">
        <SeriesSkeleton width="third" />
      </SeriesCard>
    );
  }

  const view = stagesView(page.hbars.stages, page.range);

  return (
    <SeriesCard tag={view.tag} title={view.title} width="third">
      {view.empty !== null ? (
        <SeriesEmptyState empty={NO_STAGES} />
      ) : (
        <HBars key={page.range} label={view.label} rows={view.rows} />
      )}
      {view.line !== null && <p className="insights-series__foot">{view.line}</p>}
    </SeriesCard>
  );
}
