import { type ReactNode, useId } from "react";

import { Card, CardHead, EmptyState, Tag, cx } from "@/app/ui";

import type { SeriesEmpty } from "./series-view";

/**
 * The frame both time-series cards share (BK.3, [#444](https://github.com/NobuData/ouroboros/issues/444)):
 * mockup 15's `.card` with its uppercase title and the window's tag at the trailing edge, the
 * chart's designed empty state, and the skeleton that holds the chart's place.
 */

/** Which of the mockup's widths a card takes: the throughput card's `c-8` or the cost card's `c-6`. */
export type SeriesWidth = "wide" | "half";

/** The grid placement each width takes. */
const WIDTH_CLASS: Record<SeriesWidth, string> = {
  wide: "insights-series insights-col--8",
  half: "insights-series insights-col--6",
};

/** The chart's reserved shape each width takes — the viewBox's aspect, so nothing moves on arrival. */
const PLOT_CLASS: Record<SeriesWidth, string> = {
  wide: "insights-series__plot insights-series__plot--wide",
  half: "insights-series__plot insights-series__plot--half",
};

/**
 * A time-series card.
 *
 * @param props.title The heading — what the chart shows.
 * @param props.tag The window it covers — `Jul 10 – Aug 8` — or `null` while nothing is read.
 * @param props.width Its width in the grid.
 * @param props.busy Whether it is a skeleton waiting on a read.
 * @param props.children The chart, or its empty state, and anything under it.
 * @returns The card, a named region.
 */
export function SeriesCard({
  title,
  tag,
  width,
  busy = false,
  children,
}: Readonly<{
  title: string;
  tag: string | null;
  width: SeriesWidth;
  busy?: boolean;
  children: ReactNode;
}>) {
  const titleId = useId();

  return (
    <Card aria-busy={busy || undefined} aria-labelledby={titleId} as="section" className={WIDTH_CLASS[width]} fill>
      <CardHead
        title={title}
        titleId={titleId}
        trailing={tag === null ? <span aria-hidden="true" className="insights-series__tag-slot" /> : <Tag>{tag}</Tag>}
      />
      {children}
    </Card>
  );
}

/**
 * The chart's place while nothing has been read: a bar at the chart's own aspect, so the page
 * does not move when it lands. It says nothing to a screen reader — the card is `aria-busy`.
 *
 * @param props.width The card's width, which sets the shape reserved.
 * @returns The placeholder.
 */
export function SeriesSkeleton({ width }: Readonly<{ width: SeriesWidth }>) {
  return <div aria-hidden="true" className={cx(PLOT_CLASS[width], "insights-series__skeleton")} />;
}

/**
 * The chart's designed empty state, at the chart's own height — never a flat line at zero.
 *
 * @param props.empty What is not there and why.
 * @returns The empty state.
 */
export function SeriesEmptyState({ empty }: Readonly<{ empty: SeriesEmpty }>) {
  return <EmptyState fill note={empty.note} title={empty.title} />;
}
