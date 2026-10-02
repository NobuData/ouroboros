"use client";

import { TimeSeries } from "@/app/charts";
import { moneyOfCents } from "@/app/format";

import { useInsights } from "./insights-store";
import { MethodTip } from "./method-tip";
import { SeriesCard, SeriesEmptyState, SeriesSkeleton } from "./series-card";
import { COST_TITLE, costView, windowTag } from "./series-view";

/** The cost card's viewBox, the mockup's `0 0 560 140`. */
const COST_WIDTH = 560;
const COST_HEIGHT = 140;

/** The mockup's cost chart has two gridlines above its baseline, not the primitive's three. */
const COST_GRIDLINES = 2;

/**
 * Mockup 15's **DAILY COST · ALL PROVIDERS** card (BK.3, [#444](https://github.com/NobuData/ouroboros/issues/444)).
 *
 * The `TimeSeries` primitive over the daily priced spend, with the furniture `costView` decides
 * (`app/insights/series-view.ts`): the dashed budget guide **only** from a real provider cap,
 * the spike labelled with its bare value — nothing in the data attributes it — and the endpoint
 * label. Under it, the projection footer, whose *Projected month* names its method
 * (linear-to-date) in a tooltip. The mockup's *"alerts fire at 90%"* is not drawn: nothing fires
 * a cap alert until #237 lands (decision **I8**).
 *
 * @returns The card.
 */
export function CostCard() {
  const { page } = useInsights();

  if (page === null) {
    return (
      <SeriesCard busy tag={null} title={COST_TITLE} width="half">
        <SeriesSkeleton width="half" />
      </SeriesCard>
    );
  }

  const view = costView(page.series.cost, page.range);

  return (
    <SeriesCard tag={windowTag(page.window)} title={COST_TITLE} width="half">
      {view.empty !== null ? (
        <SeriesEmptyState empty={view.empty} />
      ) : (
        <TimeSeries
          annotation={view.annotation}
          formatValue={moneyOfCents}
          gridlines={COST_GRIDLINES}
          guide={view.guide}
          height={COST_HEIGHT}
          key={page.range}
          label={view.label}
          points={view.points}
          size="half"
          width={COST_WIDTH}
        />
      )}
      {view.projection !== null && (
        <p className="insights-series__foot">
          <MethodTip label={view.projection.lead} method={view.projection.method}>
            {view.projection.figures}
          </MethodTip>
        </p>
      )}
    </SeriesCard>
  );
}
