"use client";

import { useState } from "react";

import type { DurationChart } from "@/app/api/analyzer";
import { TimeSeries } from "@/app/charts";
import { Card, CardHead, EmptyState, Tag } from "@/app/ui";

import { useAnalyzer } from "./analyzer-store";
import { ChangePointSheet } from "./change-point-sheet";
import {
  DURATION_ANCHOR,
  DURATION_CAPTION,
  DURATION_TAG,
  MARKERS_LABEL,
  durationAxis,
  durationChartLabel,
  durationEmpty,
  durationMarkers,
  durationPoints,
  durationSpan,
  durationTicks,
  durationTitle,
} from "./duration-view";

/** The plot's height in viewBox units: mockup 18's `640 × 220`, less the two chip rows above it. */
const PLOT_HEIGHT = 180;

/**
 * Mockup 18's **Build duration · 90 days, with detected change-points** (BW.2,
 * [#517](https://github.com/NobuData/ouroboros/issues/517)) — the first thing a visitor to the
 * analyzer looks at.
 *
 * The BK.1 `TimeSeries` over the run's daily-median durations, with its annotation layer: a dashed
 * vertical at each detected breakpoint and a chip naming the date, the top attribution candidate
 * and the measured delta — tinted by the delta's sign, so a faster build is never a warning. The
 * chips are **the run's findings and nothing else** (`durationMarkers`): a finding that changes
 * changes the chart, and no chip exists without one.
 *
 * A chip is a button, reached by Tab, and opens the Details sheet — the ranked candidates with
 * their scores, the attribution window, and evidence that links into the farm, the PR page and the
 * workflow studio (`change-point-sheet.tsx`). The chart's image is named by a sentence summarising
 * the series, and each chip carries its own change in words.
 *
 * The series and the findings arrive in one payload (`page.duration`), so a switch of repository
 * or a new run never leaves one run's chips over another's curve. Before the page is read the
 * card holds the chart's place; before any run has looked for change-points it says so.
 *
 * @returns The card.
 */
export function DurationCard() {
  const { page } = useAnalyzer();
  // A fixed id rather than `useId`'s: the card is drawn once, and its heading is a link target.
  const titleId = DURATION_ANCHOR;
  const [opened, setOpened] = useState<string | null>(null);
  const chart = page?.duration ?? null;
  const point = chart?.changePoints.find((candidate) => candidate.id === opened) ?? null;

  return (
    <Card
      aria-busy={chart === null || undefined}
      aria-labelledby={titleId}
      as="section"
      className="analyzer-duration"
      fill
    >
      <CardHead title={durationTitle(chart)} titleId={titleId} trailing={<Tag>{DURATION_TAG}</Tag>} />
      {chart === null ? (
        <div aria-hidden="true" className="analyzer-duration__skeleton" />
      ) : (
        <DurationPlot chart={chart} onOpen={setOpened} />
      )}
      <ChangePointSheet onClose={() => setOpened(null)} point={point} />
    </Card>
  );
}

/**
 * The chart itself, or why there is none. Exported so the chart can be drawn from a value — the
 * card reads its own from the page's store.
 *
 * @param props.chart The run's series and change-points.
 * @param props.onOpen Called with a change-point's id when its chip is pressed.
 * @returns The annotated time series under its caption, or the card's empty state.
 */
export function DurationPlot({
  chart,
  onOpen,
}: Readonly<{ chart: DurationChart; onOpen: (id: string) => void }>) {
  const empty = durationEmpty(chart);
  if (empty !== null) return <EmptyState fill note={empty.note} title={empty.title} />;

  const points = durationPoints(chart.series);

  return (
    <>
      <TimeSeries
        axis={durationAxis(chart.series.map((day) => day.medianSeconds))}
        formatValue={durationSpan}
        height={PLOT_HEIGHT}
        key={chart.runId}
        label={durationChartLabel(chart)}
        markers={durationMarkers(chart)}
        markersLabel={MARKERS_LABEL}
        onMarker={onOpen}
        points={points}
        ticks={durationTicks(points.length)}
      />
      <p className="analyzer-duration__caption">{DURATION_CAPTION}</p>
    </>
  );
}
