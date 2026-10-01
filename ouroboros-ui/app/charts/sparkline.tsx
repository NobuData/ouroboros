import { cx } from "@/app/ui/class-names";

import { fractionOf, percentProperty } from "./geometry";
import { chartVars } from "./vars";

import "./charts.css";

/**
 * Mockup 15's `.spark` — a strip of tiny CSS bars beside a figure
 * ([#442](https://github.com/NobuData/ouroboros/issues/442)).
 *
 * The flaky-test history and the DORA cells draw it. In both the figure beside the strip
 * already says the value, so by default the strip is decoration and hidden from the
 * accessibility tree — the {@link Meter} rule. Pass {@link SparklineProps.label} where the
 * strip is the only statement of its trend and it becomes a named `role="img"`.
 */

/** What a sparkline takes. */
export interface SparklineProps {
  /** The values, oldest first. Each bar is scaled to the largest. */
  readonly values: readonly number[];
  /** Draw the bars receded — the flaky card's `fixed` row, the DORA cell that is flat. */
  readonly dim?: boolean;
  /**
   * What the strip shows and its headline, when nothing beside it says so. Omitted, the strip
   * is hidden from assistive technology.
   */
  readonly label?: string;
  /** Classes from the page — placement only. */
  readonly className?: string;
}

/**
 * A sparkline of CSS bars.
 *
 * @param props See {@link SparklineProps}.
 * @returns The strip.
 */
export function Sparkline({ values, dim = false, label, className }: SparklineProps) {
  const max = Math.max(0, ...values.filter(Number.isFinite));
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };

  return (
    <div className={cx("chart-spark", dim && "chart-spark--dim", className)} {...a11y}>
      {values.map((value, index) => (
        <i
          key={index}
          className="chart-spark__bar"
          style={chartVars({ "--chart-fill": percentProperty(fractionOf(value, max)) })}
        />
      ))}
    </div>
  );
}
