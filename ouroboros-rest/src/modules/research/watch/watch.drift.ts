/**
 * Is this drift, or is it noise? — the regression watch's one judgement (CM.4,
 * [#623](https://github.com/NobuData/ouroboros/issues/623); decision V6).
 *
 * **Window against window, never number against number.** A baseline is the statistics of the
 * samples a release was measured over; a nightly reading is the same for the last few days.
 * {@link evaluateDrift} compares the two under the metric's threshold rule
 * (`regression_threshold()`, V115), and it takes three things for a difference to count:
 *
 *   1. **enough samples** — fewer than `min_samples` in the current window says nothing yet;
 *   2. **clear of the baseline's own spread** — a move smaller than `min_spread_multiple ×` the
 *      baseline's spread is inside what the release itself varied by;
 *   3. **in the direction that is worse** — and at least `warn_pct` of the baseline (`err_pct`
 *      for `err`). A boot time that got faster is not a regression.
 *
 * Anything short of that is `within`, with the reason in words, and **opens no watch item** —
 * a card that cries wolf is ignored, which is worse than no card.
 *
 * **The drift is printed in the unit a person thinks in.** A timing drifts in its own unit
 * (`+230 ms`); a metric that is itself a percentage drifts in points; everything else drifts as
 * a percentage of its baseline (`+14%`).
 */

/** The statistics of one measurement window — V115's `regression_window_valid` shape. */
export interface WindowStats {
  readonly n: number;
  readonly median: number;
  readonly spread: number;
  readonly spread_kind: "iqr" | "stddev" | "mad";
  readonly unit: string;
  /** ISO-8601 with an offset. */
  readonly from: string;
  readonly to: string;
}

/** A metric class — which threshold defaults apply. */
export type MetricClass = "timing" | "accuracy" | "resource" | "rate";

/** Every metric class. */
export const METRIC_CLASSES: readonly MetricClass[] = ["timing", "accuracy", "resource", "rate"];

/** An effective threshold rule — `regression_threshold()`'s answer. */
export interface ThresholdRule {
  readonly direction: "higher_is_worse" | "lower_is_worse" | "either";
  readonly warn_pct: number;
  readonly err_pct: number;
  readonly min_spread_multiple: number;
  readonly min_samples: number;
}

/** What a comparison concluded. */
export type DriftVerdict =
  | {
      readonly status: "drift";
      readonly severity: "err" | "warn";
      /** The signed drift, in {@link driftUnit}. */
      readonly driftValue: number;
      /** `%`, or the metric's own unit for a timing. */
      readonly driftUnit: string;
      /** The signed move in the metric's own unit. */
      readonly delta: number;
      /** The move as a percentage of the baseline. */
      readonly deltaPct: number;
    }
  | {
      readonly status: "within";
      readonly reason: string;
      /**
       * Whether the two windows were actually compared. False when there was too little to
       * compare — too few samples, different units, a zero baseline — which says nothing about
       * a drift already found.
       */
      readonly measured: boolean;
    };

/**
 * Round for display and storage: two decimals at most, never `-0`.
 *
 * @param value - A number.
 * @returns It, rounded.
 */
export function tidy(value: number): number {
  const rounded = Math.round(value * 100) / 100;

  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Judge a current window against a baseline.
 *
 * @param baseline - The release's window.
 * @param current - The nightly window, in the same unit.
 * @param rule - The metric's effective threshold rule.
 * @param metricClass - The metric's class, for the unit the drift is printed in.
 * @returns `drift` with a severity and the signed drift, or `within` with the reason.
 */
export function evaluateDrift(
  baseline: WindowStats,
  current: WindowStats,
  rule: ThresholdRule,
  metricClass: MetricClass,
): DriftVerdict {
  if (current.unit !== baseline.unit) {
    return {
      status: "within",
      reason: `the nightly window is in ${current.unit} and the baseline in ${baseline.unit}, so they cannot be compared`,
      measured: false,
    };
  }
  if (current.n < rule.min_samples) {
    return {
      status: "within",
      reason: `only ${current.n.toString()} sample${current.n === 1 ? "" : "s"} in the nightly window — ${rule.min_samples.toString()} are needed before a difference means anything`,
      measured: false,
    };
  }

  const delta = current.median - baseline.median;
  const noise = rule.min_spread_multiple * baseline.spread;

  if (delta === 0) {
    return {
      status: "within",
      reason: "the nightly median equals the baseline's",
      measured: true,
    };
  }
  if (Math.abs(delta) < noise) {
    return {
      status: "within",
      reason: `a move of ${tidy(Math.abs(delta)).toString()} ${baseline.unit} is inside ${rule.min_spread_multiple.toString()}× the baseline's own spread (${tidy(noise).toString()} ${baseline.unit})`,
      measured: true,
    };
  }

  const worse =
    rule.direction === "either" || (rule.direction === "higher_is_worse" ? delta > 0 : delta < 0);

  if (!worse) {
    return {
      status: "within",
      reason: "the metric moved, in the direction that is better",
      measured: true,
    };
  }
  if (baseline.median === 0) {
    return {
      status: "within",
      reason:
        "the baseline's median is 0, so a percentage threshold has nothing to measure against",
      measured: false,
    };
  }

  const deltaPct = (delta / Math.abs(baseline.median)) * 100;
  const size = Math.abs(deltaPct);

  if (size < rule.warn_pct) {
    return {
      status: "within",
      reason: `a move of ${tidy(size).toString()}% is under the ${rule.warn_pct.toString()}% warning threshold`,
      measured: true,
    };
  }

  // A timing reads best in its own unit; a percentage metric moves in points, which is also
  // `%`; anything else as a percentage of where it started.
  const own = metricClass === "timing" || baseline.unit === "%";

  return {
    status: "drift",
    severity: size >= rule.err_pct ? "err" : "warn",
    driftValue: tidy(own ? delta : deltaPct),
    driftUnit: own ? baseline.unit : "%",
    delta: tidy(delta),
    deltaPct: tidy(deltaPct),
  };
}

/**
 * A window in a few words, for an inbox card and a draft's body.
 *
 * @param window - The window.
 * @returns `median 4.7 cm (n = 7)`.
 */
export function windowPhrase(window: WindowStats): string {
  const figure =
    window.unit === "%"
      ? `${tidy(window.median).toString()}%`
      : `${tidy(window.median).toString()} ${window.unit}`;

  return `median ${figure} (n = ${window.n.toString()})`;
}

/**
 * A signed drift as the card prints it — the TypeScript twin of V115's `regression_drift_display`.
 *
 * @param value - The signed drift.
 * @param unit - Its unit.
 * @returns `+14%` or `+230 ms`.
 */
export function driftDisplay(value: number, unit: string): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toString()}${unit === "%" ? "%" : ` ${unit}`}`;
}
