import { type ReactNode, useId } from "react";

import { Card, CardHead, Meter } from "@/app/ui";

import {
  COST_LABEL,
  FARM_LABEL,
  type FarmDot,
  type MeterRowView,
  RESOURCES_TITLE,
  type ResourcesView,
  TOKENS_LABEL,
  WALL_CLOCK_LABEL,
} from "./cards";
import { ElapsedFigure } from "./elapsed-figure";
import type { RunElapsed } from "./view";

/** The farm row's dot, per state. */
const FARM_DOT_CLASS: Readonly<Record<FarmDot, string>> = {
  idle: "run-resources__dot run-resources__dot--idle",
  live: "run-resources__dot run-resources__dot--live",
  ok: "run-resources__dot run-resources__dot--ok",
  warn: "run-resources__dot run-resources__dot--warn",
  err: "run-resources__dot run-resources__dot--err",
};

/**
 * One labelled row: the label leading, the figure trailing.
 *
 * @param props.label The row's name.
 * @param props.children The figure.
 * @returns The row's line.
 */
function Line({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="run-resources__line">
      <span className="run-resources__label">{label}</span>
      <span className="run-resources__figure">{children}</span>
    </div>
  );
}

/**
 * A meter row — the figure, its note, and a bar only when there is a denominator.
 *
 * @param props.label The row's name.
 * @param props.row The row, from `cards.ts`.
 * @returns The row.
 */
function MeterRow({ label, row }: Readonly<{ label: string; row: MeterRowView }>) {
  return (
    <div className="run-resources__row">
      <Line label={label}>{row.figure}</Line>
      {row.note !== null && <p className="run-resources__note">{row.note}</p>}
      {row.fraction !== null && <Meter tone={row.tone} value={row.fraction} />}
    </div>
  );
}

/**
 * Mockup 10's *Resources* ([#313](https://github.com/NobuData/ouroboros/issues/313)) — tokens,
 * cost, the farm reservation and the wall clock.
 *
 * Every figure is `cards.ts`'s: a meter only against a pinned budget or a cap, `— · N tokens`
 * for an unpriced cost, and no farm row at all when the run holds no reservation. The wall clock
 * is the head's anchored elapsed, so the two never disagree.
 *
 * @param props.view The card, from `resourcesView`.
 * @param props.elapsed The run's elapsed time, from `runElapsed`.
 * @returns The card.
 */
export function ResourcesCard({ view, elapsed }: Readonly<{ view: ResourcesView; elapsed: RunElapsed }>) {
  const titleId = useId();

  return (
    <Card aria-labelledby={titleId} as="section" className="run-resources">
      <CardHead title={RESOURCES_TITLE} titleId={titleId} />

      <div className="run-resources__list">
        <MeterRow label={TOKENS_LABEL} row={view.tokens} />
        <MeterRow label={COST_LABEL} row={view.cost} />

        {view.farm !== null && (
          <div className="run-resources__row">
            <Line label={FARM_LABEL}>
              <span aria-hidden className={FARM_DOT_CLASS[view.farm.dot]} />
              {view.farm.figure}
            </Line>
          </div>
        )}

        <div className="run-resources__row">
          <Line label={WALL_CLOCK_LABEL}>
            <ElapsedFigure elapsed={elapsed} />
          </Line>
        </div>
      </div>
    </Card>
  );
}
