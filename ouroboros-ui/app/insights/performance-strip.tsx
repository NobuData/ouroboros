"use client";

import { useId } from "react";

import { Card, Tag, cx } from "@/app/ui";

import { useInsights } from "./insights-store";
import { PERFORMANCE_TITLE, type PerformanceCellView, performanceView } from "./performance-view";

/**
 * Mockup 15's **BUILD & TEST PERFORMANCE · 30D** strip (BK.5, [#446](https://github.com/NobuData/ouroboros/issues/446)).
 *
 * A full-width hairline card: the title, the six bordered cells BJ.2 serves — builds, the success
 * split with its failures in the error hue, cases run, pass rate, tokens and cost — and the scope
 * tag. The cells are a description list in their own horizontal scroll wrapper, so a narrow pane
 * scrolls the strip rather than the page. The cost cell's rules are `costCell`'s: tokens and no
 * dollars where the usage was not priced.
 *
 * @returns The strip — `aria-busy` with no cells before anything is read.
 */
export function PerformanceStrip() {
  const { page } = useInsights();
  const titleId = useId();
  const view = page === null ? null : performanceView(page);

  return (
    <Card
      aria-busy={view === null || undefined}
      aria-labelledby={titleId}
      as="section"
      className="insights-perf insights-col--12"
    >
      <h2 className={cx("ou-card__title", "insights-perf__title")} id={titleId}>
        {view?.title ?? PERFORMANCE_TITLE}
      </h2>
      <div className="insights-scroll insights-perf__scroll">
        <dl className="insights-perf__cells">
          {view?.cells.map((cell) => <PerformanceCell cell={cell} key={cell.key} />)}
        </dl>
      </div>
      {view !== null && <Tag className="insights-perf__scope">{view.scope}</Tag>}
    </Card>
  );
}

/**
 * One cell: its caption, its figure, and the split or note after it.
 *
 * @param props.cell The cell.
 * @returns The cell.
 */
function PerformanceCell({ cell }: Readonly<{ cell: PerformanceCellView }>) {
  return (
    <div className="insights-perf__cell">
      <dt className="insights-perf__label">{cell.label}</dt>
      <dd className="insights-perf__value">{cell.value}</dd>
      {cell.split !== null && (
        <dd className="insights-perf__label">
          <span aria-hidden="true">
            {cell.split.succeeded} ✓ / <span className="insights-perf__failed">{cell.split.failed} ✗</span>
          </span>
          <span className="sr-only">{cell.split.words}</span>
        </dd>
      )}
      {cell.note !== null && <dd className="insights-perf__label">{cell.note}</dd>}
    </div>
  );
}
