import { EffortChip, type Effort } from "@/app/ui/chip";
import { cx } from "@/app/ui/class-names";

import { fractionOf, percentProperty } from "./geometry";
import { chartVars } from "./vars";

import "./charts.css";

/**
 * Mockup 15's `.hbar` rows — a label, a bar and a value, ranked
 * ([#442](https://github.com/NobuData/ouroboros/issues/442)).
 *
 * Five cards draw this shape: intervention causes, stage medians, suite failures, the
 * completion ladder by effort, and tokens by stage. They differ in three ways, and each is a
 * prop: which rows are emphasised (`top`) or receded (`dim`), whether the bars wear the
 * model hue (the token card), and whether a row's label is an effort chip.
 *
 * Bars are scaled to the largest value in the set, so the longest bar is always full width —
 * the mockup's shape. The whole set is one `role="img"`: its name is
 * {@link HBarsProps.label} followed by every row in words, so a screen reader hears the
 * ranking without the geometry.
 */

/** One row. */
export interface HBarRow {
  /** The row's name in words — the label, and what a screen reader hears. */
  readonly name: string;
  /** The value the bar is scaled by. */
  readonly value: number;
  /** The value as drawn — `6m 04s`, `126M`. Defaults to the value itself. */
  readonly display?: string;
  /** Draw an effort chip in the label's place (the completion ladder). */
  readonly effort?: Effort;
  /** `top` lifts the row; `dim` recedes it. Omitted, the row is drawn plainly. */
  readonly emphasis?: "top" | "dim";
}

/** What the bar rows take. */
export interface HBarsProps {
  /** What the bars show and the headline — the start of the accessible name. */
  readonly label: string;
  /** The rows, in the order drawn. */
  readonly rows: readonly HBarRow[];
  /** `model` draws the bars in the model hue, for token counts. Defaults to `accent`. */
  readonly hue?: "accent" | "model";
  /** Classes from the page — placement only. */
  readonly className?: string;
}

/**
 * The accessible name: the caller's label, then every row as `name value`.
 *
 * @param label The caller's label.
 * @param rows The rows.
 * @returns `Interventions by cause, 20 total: Flaky env / rig 8, Ambiguous ticket 5`.
 */
export function hBarsLabel(label: string, rows: readonly HBarRow[]): string {
  if (rows.length === 0) return label;

  return `${label}: ${rows.map((row) => `${row.name} ${row.display ?? row.value}`).join(", ")}`;
}

/**
 * Ranked horizontal bars.
 *
 * @param props See {@link HBarsProps}.
 * @returns The rows.
 */
export function HBars({ label, rows, hue = "accent", className }: HBarsProps) {
  const max = Math.max(0, ...rows.map((row) => (Number.isFinite(row.value) ? row.value : 0)));

  return (
    <div
      className={cx("chart-hbars", hue === "model" && "chart-hbars--model", className)}
      role="img"
      aria-label={hBarsLabel(label, rows)}
    >
      {rows.map((row, index) => (
        <div
          key={`${row.name}-${index}`}
          className={cx(
            "chart-hbar",
            row.emphasis === "top" && "chart-hbar--top",
            row.emphasis === "dim" && "chart-hbar--dim",
          )}
        >
          <span className="chart-hbar__label" title={row.name}>
            {row.effort ? <EffortChip effort={row.effort} /> : row.name}
          </span>
          <span
            className="chart-hbar__bar"
            style={chartVars({ "--chart-fill": percentProperty(fractionOf(row.value, max)) })}
          />
          <span className="chart-hbar__value">{row.display ?? row.value}</span>
        </div>
      ))}
    </div>
  );
}
