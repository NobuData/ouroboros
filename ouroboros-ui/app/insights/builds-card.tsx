"use client";

import { StackedVBars } from "@/app/charts";

import { useInsights } from "./insights-store";
import { BUILDS_TITLE, buildsView } from "./performance-view";
import { SeriesCard, SeriesEmptyState, SeriesSkeleton } from "./series-card";

/**
 * Mockup 15's **BUILDS PER DAY — SUCCEEDED VS FAILED** card (BK.5, [#446](https://github.com/NobuData/ouroboros/issues/446)).
 *
 * The `StackedVBars` primitive over BJ.2's builds series: a success segment per day capped by its
 * failures, the window's worst day carrying the floating `18 · 2 failed` note, and the legend.
 * The bars sit in their own scroll wrapper, so a narrow pane scrolls the card, never the page.
 *
 * **No cluster line.** The mockup's *"Failures cluster on deps-refresh days — the analyzer noticed
 * too"* is the build analyzer's `cache_window` finding (#512); until the payload carries that
 * finding, the line is absent rather than softened (decision I10, `performance-view.ts`).
 *
 * @returns The card.
 */
export function BuildsCard() {
  const { page } = useInsights();

  if (page === null) {
    return (
      <SeriesCard busy tag={null} title={BUILDS_TITLE} width="third">
        <SeriesSkeleton width="third" />
      </SeriesCard>
    );
  }

  const view = buildsView(page);

  return (
    <SeriesCard tag={view.tag} title={BUILDS_TITLE} width="third">
      {view.empty !== null ? (
        <SeriesEmptyState empty={view.empty} />
      ) : (
        <div className="insights-scroll">
          <StackedVBars
            className="insights-scroll__chart"
            days={view.days}
            key={page.range}
            label={view.label}
            note={view.note}
          />
        </div>
      )}
    </SeriesCard>
  );
}
