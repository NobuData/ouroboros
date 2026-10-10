/**
 * A reading: one metric over one window, or the honest absence of one (CL.6,
 * [#619](https://github.com/NobuData/ouroboros/issues/619)).
 *
 * ```
 * metric × window ──▶ ok      {value, n, median, spread, unit}
 *                 └─▶ no_data {window searched, reason}          — never 0
 * ```
 *
 * **Empty is not zero.** A window with no samples, a rate with no denominator, a release with no
 * captured baseline: each is `no_data`, and that shape has no numeric field a zero could sit in.
 * A brief that claimed a metric "improved to nothing" from a zero-filled window would be the most
 * damaging quiet error this tool could make, so the type forbids it.
 *
 * The same reading backs `metric_window` and both sides of `compare` — and CM.4's nightly check
 * (#623) calls `compare` — so the watch card and a brief cannot disagree about a number.
 */

import type { MetricSpan } from "../../insights/metrics/metrics.types";
import type { MeasurementSample, StoredBaseline } from "./telemetry.repository";
import { deltaOf, quantile, round, signed, summarize, type Delta } from "./telemetry.stats";

/** What a reading's `n` counts. */
export type ReadingBasis =
  /** Individual samples — measurements, or a median metric's pooled values. */
  | "samples"
  /** A rate's denominator: the events the percentage is of. */
  | "denominator"
  /** The days that recorded anything — a sum has no finer grain. */
  | "days"
  /** The sample count a release's baseline was captured with. */
  | "baseline";

/** A window as a reading reports it. */
export interface ReadingWindow {
  /** The window as cited: an absolute range, or `baseline:<tag>`. */
  readonly window: string;
  /** Its first instant or day; `null` for a baseline nobody captured. */
  readonly from: string | null;
  /** Its end. An instant window is `[from, to)`; a day window includes its last day. */
  readonly to: string | null;
}

/** A metric over a window, measured. */
export interface OkReading extends ReadingWindow {
  readonly status: "ok";
  /** The figure — the metric's own aggregate for an insights metric, the median for a sample. */
  readonly value: number;
  readonly unit: string;
  /** How many of {@link basis} the figure rests on. */
  readonly n: number;
  readonly basis: ReadingBasis;
  /** The sample's median; `null` for a rate or a sum, which have none. */
  readonly median: number | null;
  /** The sample's spread; `null` when {@link median} is. */
  readonly spread: number | null;
  /** What the spread is — `iqr` for a live window, the baseline's own kind for a baseline. */
  readonly spreadKind: string | null;
}

/** A window in which nothing was measured. */
export interface NoDataReading extends ReadingWindow {
  readonly status: "no_data";
  /** Why, in words — and what was searched. */
  readonly reason: string;
}

/** A reading. */
export type Reading = OkReading | NoDataReading;

/** Two readings of one metric, compared. */
export type Comparison =
  | ({ readonly status: "ok"; readonly unit: string; readonly display: string } & Delta)
  | { readonly status: "no_data"; readonly reason: string };

/** An insights unit as a reading prints it. */
const UNITS: Readonly<Record<string, string>> = {
  pct: "%",
  duration_ms: "ms",
  count: "count",
  cents: "cents",
  tokens: "tokens",
};

/**
 * A reading of an insights metric over a span of days.
 *
 * @param span - What `MetricsService.span()` answered.
 * @param window - The window as cited.
 * @returns `ok` with the metric's own figure, or `no_data` when no day of the span recorded
 *   anything, or a rate had no denominator. A sum over days that recorded nothing is **not** 0.
 */
export function metricReading(span: MetricSpan, window: string): Reading {
  const at = { window, from: span.from, to: span.to };

  if (span.days === 0 || span.value === null) {
    return {
      ...at,
      status: "no_data",
      reason:
        span.days === 0
          ? `${span.metricId} has nothing recorded on any day of ${window}`
          : `${span.metricId} has nothing to compute from in ${window} — a rate with no denominator, or a median with no samples`,
    };
  }

  const unit = UNITS[span.methodology.unit] ?? span.methodology.unit;

  if (span.methodology.aggregation === "median") {
    return {
      ...at,
      status: "ok",
      value: span.value,
      unit,
      n: span.samples.length,
      basis: "samples",
      median: span.value,
      spread: round(quantile(span.samples, 0.75) - quantile(span.samples, 0.25)),
      spreadKind: "iqr",
    };
  }

  return {
    ...at,
    status: "ok",
    // The insights plane's own figure, untouched: a citation must match the page digit for digit.
    value: span.value,
    unit,
    n: span.components?.denominator ?? span.days,
    basis: span.components === undefined ? "days" : "denominator",
    median: null,
    spread: null,
    spreadKind: null,
  };
}

/**
 * A reading of a case metric from its HIL measurements.
 *
 * @param samples - The measurements taken in the window.
 * @param metricKey - The metric's key, for the reason.
 * @param window - The window as cited, with its bounds.
 * @returns `ok` with the median and interquartile range, or `no_data` for an empty window — or
 *   for samples recorded in more than one unit, which have no single median.
 */
export function sampleReading(
  samples: readonly MeasurementSample[],
  metricKey: string,
  window: ReadingWindow,
): Reading {
  const summary = summarize(samples.map((sample) => sample.value));

  if (summary === null) {
    return {
      ...window,
      status: "no_data",
      reason: `no measurement of ${metricKey} was taken in ${window.window}`,
    };
  }

  const units = [...new Set(samples.map((sample) => sample.unit))];

  if (units.length > 1) {
    return {
      ...window,
      status: "no_data",
      reason: `${metricKey} was recorded in more than one unit in ${window.window} (${units.join(", ")}) — no single figure describes it`,
    };
  }

  return {
    ...window,
    status: "ok",
    value: summary.median,
    unit: units[0],
    n: summary.n,
    basis: "samples",
    median: summary.median,
    spread: summary.spread,
    spreadKind: "iqr",
  };
}

/**
 * A reading of a release's captured baseline.
 *
 * @param baseline - The stored baseline, or `undefined` when the release captured none.
 * @param metricKey - The metric's key, for the reason.
 * @param window - `baseline:<tag>`.
 * @param tag - The release tag.
 * @returns `ok` with the baseline's stored statistics and the window it was captured over, or
 *   `no_data` naming the tag that has no baseline.
 */
export function baselineReading(
  baseline: StoredBaseline | undefined,
  metricKey: string,
  window: string,
  tag: string,
): Reading {
  if (baseline === undefined) {
    return {
      window,
      from: null,
      to: null,
      status: "no_data",
      reason: `no baseline of ${metricKey} was captured for release ${tag}`,
    };
  }

  return {
    window,
    from: baseline.from,
    to: baseline.to,
    status: "ok",
    value: baseline.median,
    unit: baseline.unit,
    n: baseline.n,
    basis: "baseline",
    median: baseline.median,
    spread: baseline.spread,
    spreadKind: baseline.spreadKind,
  };
}

/**
 * Compare two readings of one metric.
 *
 * @param a - The first window — what the difference is measured from.
 * @param b - The second window.
 * @returns The signed delta `b − a` with its unit, the same as a percentage of `a`, and how a
 *   citation prints it — or `no_data` when either window has none, or the two are in different
 *   units. A missing side never becomes a zero to subtract.
 */
export function compareReadings(a: Reading, b: Reading): Comparison {
  if (a.status === "no_data" || b.status === "no_data") {
    const empty = [a, b].filter((reading) => reading.status === "no_data");

    return {
      status: "no_data",
      reason: `nothing to compare: ${empty.map((reading) => reading.reason).join("; ")}`,
    };
  }

  if (a.unit !== b.unit) {
    return {
      status: "no_data",
      reason: `the two windows are in different units (${a.unit} and ${b.unit}), so they have no difference`,
    };
  }

  const delta = deltaOf(a.value, b.value);

  return {
    status: "ok",
    unit: a.unit,
    ...delta,
    // A percentage metric moves in points — "+3%" of a rate would be ambiguous — and anything
    // else reads best as a percentage of where it started, with the absolute move beside it.
    display:
      a.unit === "%"
        ? signed(delta.delta, "pts")
        : delta.deltaPct === null
          ? signed(delta.delta, a.unit)
          : `${signed(delta.deltaPct, "%")} (${signed(delta.delta, a.unit)})`,
  };
}

/**
 * A reading in a sentence, for a citation's excerpt.
 *
 * @param subject - What was read — a metric's key.
 * @param reading - The reading.
 * @returns `merge_rate = 92% over 2026-09-10..2026-10-09 (n = 25, denominator)`, or with a
 *   median `… median 2.4% (iqr 0.175, n = 4 samples) over …`, or the no-data sentence.
 */
export function readingSentence(subject: string, reading: Reading): string {
  if (reading.status === "no_data") {
    return `No data — ${reading.reason}. Not zero: nothing was measured.`;
  }

  const figure =
    reading.unit === "%" ? `${String(reading.value)}%` : `${String(reading.value)} ${reading.unit}`;

  return reading.median === null
    ? `${subject} = ${figure} over ${reading.window} (n = ${String(reading.n)}, ${reading.basis})`
    : `${subject}: median ${figure} (${reading.spreadKind ?? "spread"} ${String(reading.spread)}, n = ${String(reading.n)} ${reading.basis}) over ${reading.window}`;
}
