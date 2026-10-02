"use client";

import { TimeSeries } from "@/app/charts";

import { useInsights } from "./insights-store";
import { SeriesCard, SeriesEmptyState, SeriesSkeleton } from "./series-card";
import { NO_THROUGHPUT, throughputView, windowTag } from "./series-view";

/**
 * Mockup 15's **MERGED PRS PER DAY · 30D** card (BK.3, [#444](https://github.com/NobuData/ouroboros/issues/444)).
 *
 * The `TimeSeries` primitive over the throughput series: an endpoint dot with its direct label,
 * and a crosshair whose tooltip composes the day's merges, priced spend and interventions — the
 * cost fragment omitted on an unpriced day (`throughputMeta`). The primitive's columns are the
 * keyboard stops, each named by that same sentence, so the detail is announced as it is reached.
 *
 * Drawn for **the page's own range**, as the KPI row is, so a switch in flight never puts one
 * window's chart under another's heading. Before anything is read it is a skeleton.
 *
 * @returns The card.
 */
export function ThroughputCard() {
  const { page, range } = useInsights();

  if (page === null) {
    return (
      <SeriesCard busy tag={null} title={`Merged PRs per day · ${range}`} width="wide">
        <SeriesSkeleton width="wide" />
      </SeriesCard>
    );
  }

  const view = throughputView(page.series.throughput, page.range);

  return (
    <SeriesCard tag={windowTag(page.window)} title={view.title} width="wide">
      {view.points === null ? (
        <SeriesEmptyState empty={NO_THROUGHPUT} />
      ) : (
        <TimeSeries key={page.range} label={view.label} points={view.points} />
      )}
    </SeriesCard>
  );
}
