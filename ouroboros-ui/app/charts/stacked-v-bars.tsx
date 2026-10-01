import { cx } from "@/app/ui/class-names";

import { fractionOf, percentProperty } from "./geometry";
import { chartVars } from "./vars";

import "./charts.css";

/**
 * Mockup 15's builds-per-day bars — a success segment per day, capped by a failure segment
 * where there were failures ([#442](https://github.com/NobuData/ouroboros/issues/442)).
 *
 * Every day is scaled to the busiest, so the tallest bar fills the strip. A day can be drawn
 * **hot** — the page decides which days are failure-heavy enough to lift — and one day can
 * carry a floating **data note** (`18 · 2 failed`), which also lifts it. A legend names the
 * two segments.
 *
 * The strip is one `role="img"` named by {@link StackedVBarsProps.label}, which must state what
 * it shows and its headline; thirty bars read aloud would be noise.
 */

/** One day. */
export interface VBarDay {
  /** The day, for the page's own reference — `Aug 4`. Not drawn. */
  readonly label: string;
  /** Builds that succeeded. */
  readonly succeeded: number;
  /** Builds that failed. */
  readonly failed: number;
  /** Lift the day — a failure-heavy one, by the page's measure. */
  readonly hot?: boolean;
}

/** A note floated over one day. */
export interface VBarNote {
  /** Which day, by index. Out of range draws nothing. */
  readonly index: number;
  /** What it says — `18 · 2 failed`. */
  readonly text: string;
}

/** What the stacked bars take. */
export interface StackedVBarsProps {
  /** What the bars show and the headline — the accessible name. */
  readonly label: string;
  /** The days, oldest first. */
  readonly days: readonly VBarDay[];
  /** One day's floating note, if any. */
  readonly note?: VBarNote;
  /** The legend's two words. Defaults to `succeeded` and `failed`. */
  readonly legend?: { readonly succeeded: string; readonly failed: string };
  /** Classes from the page — placement only. */
  readonly className?: string;
}

/**
 * A count, with anything that is not a non-negative finite number taken as none.
 *
 * @param value The count.
 * @returns It, or `0`.
 */
function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Stacked daily bars with a legend.
 *
 * @param props See {@link StackedVBarsProps}.
 * @returns The strip and its legend.
 */
export function StackedVBars({
  label,
  days,
  note,
  legend = { succeeded: "succeeded", failed: "failed" },
  className,
}: StackedVBarsProps) {
  const max = Math.max(0, ...days.map((day) => count(day.succeeded) + count(day.failed)));
  const noted = note && note.index >= 0 && note.index < days.length ? note : undefined;

  return (
    <div className={className}>
      <div className="chart-vbars" role="img" aria-label={label}>
        {noted ? (
          <span
            className="chart-vbars__note"
            style={chartVars({ "--chart-x": percentProperty((noted.index + 0.5) / days.length) })}
          >
            {noted.text}
          </span>
        ) : null}
        {days.map((day, index) => {
          const failed = count(day.failed);

          return (
            <div
              key={index}
              className={cx("chart-vb", (day.hot || noted?.index === index) && "chart-vb--hot")}
            >
              {failed > 0 ? (
                <i
                  className="chart-vb__seg chart-vb__seg--failed"
                  style={chartVars({ "--chart-fill": percentProperty(fractionOf(failed, max)) })}
                />
              ) : null}
              <i
                className="chart-vb__seg"
                style={chartVars({
                  "--chart-fill": percentProperty(fractionOf(count(day.succeeded), max)),
                })}
              />
            </div>
          );
        })}
      </div>
      <div className="chart-legend" aria-hidden="true">
        <span className="chart-legend__swatch" />
        {legend.succeeded}
        <span className="chart-legend__sep">·</span>
        <span className="chart-legend__swatch chart-legend__swatch--failed" />
        {legend.failed}
      </div>
    </div>
  );
}
