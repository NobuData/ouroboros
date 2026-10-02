"use client";

import { useId } from "react";

import { Sparkline } from "@/app/charts";
import { Card, CardHead, Tag, cx } from "@/app/ui";

import { DORA_CAPTION, DORA_TITLE, type DoraCellView, doraStrip } from "./dora-view";
import { useInsights } from "./insights-store";
import { KpiMethodology } from "./kpi-methodology";
import { PROXY_BADGE } from "./view";

/** The four cells' places while nothing has been read, so the strip does not move on arrival. */
const SKELETON_CELLS = [0, 1, 2, 3] as const;

/** The tone classes a cell's line takes — the stat tile's own (`app/ui/ui.css`), by goodness. */
const TONE_CLASS = {
  up: "ou-stat__delta--up",
  down: "ou-stat__delta--down",
  muted: undefined,
} as const;

/**
 * Mockup 15's **DELIVERY HEALTH · DORA-ISH** strip (BK.6, [#447](https://github.com/NobuData/ouroboros/issues/447)).
 *
 * A full-width card: the title and the caption — verbatim — then four cells, each a methodology
 * button for a caption (`KpiMethodology`, the KPI row's popover), the figure, the line under it
 * and the cell's `Sparkline`. A proxy cell — change failure rate and MTTR — wears a `proxy` tag
 * beside its caption, and its popover says the same over the formula and the caveat. Every
 * decision is `dora-view.ts`'s; a cell with nothing to measure draws no curve at all.
 *
 * @returns The strip — four placeholder cells, `aria-busy`, before anything is read.
 */
export function DoraStrip() {
  const { page } = useInsights();
  const titleId = useId();
  const cells = page === null ? null : doraStrip(page);

  return (
    <Card
      aria-busy={cells === null || undefined}
      aria-labelledby={titleId}
      as="section"
      className="insights-col--12"
    >
      <CardHead
        title={DORA_TITLE}
        titleId={titleId}
        trailing={<span className="insights-dora__caption">{DORA_CAPTION}</span>}
      />
      <ul className="insights-dora__cells">
        {cells === null
          ? SKELETON_CELLS.map((index) => (
              <li aria-hidden="true" className="insights-dora__cell insights-dora__cell--skeleton" key={index} />
            ))
          : cells.map((cell) => <DoraCell cell={cell} key={cell.key} />)}
      </ul>
    </Card>
  );
}

/**
 * One cell.
 *
 * @param props.cell The cell.
 * @returns The cell — its sentence for a screen reader, the figure and its curve for the eye.
 */
function DoraCell({ cell }: Readonly<{ cell: DoraCellView }>) {
  return (
    <li className="insights-dora__cell" data-metric={cell.key}>
      <div className="insights-dora__stat">
        <span className="insights-dora__label">
          <KpiMethodology label={cell.label} methodology={cell.methodology} />
          {cell.proxy && <Tag className="insights-proxy">{PROXY_BADGE}</Tag>}
        </span>
        <span className="sr-only">{cell.summary}</span>
        <span aria-hidden="true" className="insights-dora__value">
          {cell.value}
          {cell.valueSuffix !== null && <span className="insights-dora__suffix">{cell.valueSuffix}</span>}
        </span>
        <span aria-hidden="true" className={cx("ou-stat__delta", TONE_CLASS[cell.tone])}>
          {cell.delta}
        </span>
      </div>
      {cell.sparkline !== null && <Sparkline dim={cell.dim} values={cell.sparkline} />}
    </li>
  );
}
