import type { MetricSpan } from "../../insights/metrics/metrics.types";
import {
  baselineReading,
  compareReadings,
  metricReading,
  readingSentence,
  sampleReading,
  type OkReading,
  type Reading,
} from "./telemetry.readings";
import type { MeasurementSample } from "./telemetry.repository";

/**
 * Readings (#619): a metric over a window, or the designed absence of one. The rule under test
 * throughout is that **empty is not zero** — a `no_data` reading has no number in it.
 */

/**
 * A span as the insights service answers it.
 *
 * @param overrides - What this case is about.
 * @returns The span.
 */
function span(
  overrides: Partial<Omit<MetricSpan, "methodology">> & {
    unit?: MetricSpan["methodology"]["unit"];
    aggregation?: MetricSpan["methodology"]["aggregation"];
  } = {},
): MetricSpan {
  const { unit = "pct", aggregation = "ratio", ...rest } = overrides;

  return {
    metricId: "merge_rate",
    from: "2026-09-11",
    to: "2026-10-10",
    value: 91.83673469387755,
    components: { numerator: 90, denominator: 98 },
    samples: [],
    days: 30,
    methodology: {
      metricId: "merge_rate",
      title: "Merge rate",
      formula: "merged / opened",
      sources: ["runs"],
      caveats: "none",
      unit,
      version: 1,
      proxy: false,
      aggregation,
    },
    ...rest,
  };
}

/**
 * Measurements of one value each.
 *
 * @param values - The values.
 * @param unit - Their unit.
 * @returns The samples.
 */
function samples(values: readonly number[], unit = "%"): MeasurementSample[] {
  return values.map((value, n) => ({
    value,
    unit,
    verdict: "pass",
    at: new Date(`2026-10-09T0${String(n)}:00:00Z`),
  }));
}

const WINDOW = {
  window: "2026-10-03..2026-10-10",
  from: "2026-10-03T00:00:00.000Z",
  to: "2026-10-11T00:00:00.000Z",
};

/**
 * Whether a value anywhere inside a reading is a number.
 *
 * @param reading - The reading.
 * @returns Every numeric value found in it.
 */
function numbersIn(reading: Reading): number[] {
  return Object.values(reading).filter((value): value is number => typeof value === "number");
}

describe("a reading of an insights metric", () => {
  it("carries the page's own figure, untouched, with the denominator as its n", () => {
    expect(metricReading(span(), "2026-09-11..2026-10-10")).toEqual({
      status: "ok",
      window: "2026-09-11..2026-10-10",
      from: "2026-09-11",
      to: "2026-10-10",
      value: 91.83673469387755,
      unit: "%",
      n: 98,
      basis: "denominator",
      median: null,
      spread: null,
      spreadKind: null,
    });
  });

  it("gives a median metric its samples' count and interquartile range", () => {
    const reading = metricReading(
      span({
        metricId: "build_duration",
        value: 251_000,
        components: undefined,
        samples: [200_000, 240_000, 251_000, 262_000, 300_000],
        unit: "duration_ms",
        aggregation: "median",
      }),
      "2026-10-04..2026-10-10",
    );

    expect(reading).toMatchObject({
      status: "ok",
      value: 251_000,
      median: 251_000,
      unit: "ms",
      n: 5,
      basis: "samples",
      spread: 22_000,
      spreadKind: "iqr",
    });
  });

  it("counts a sum's days, having no finer basis", () => {
    const reading = metricReading(
      span({
        metricId: "merged_prs",
        value: 90,
        components: undefined,
        days: 27,
        unit: "count",
        aggregation: "sum",
      }),
      "2026-09-11..2026-10-10",
    );

    expect(reading).toMatchObject({
      status: "ok",
      value: 90,
      unit: "count",
      n: 27,
      basis: "days",
      median: null,
    });
  });

  it("is no data — never 0 — for a sum over days that recorded nothing", () => {
    // The insights composition answers 0 for a sum over nothing. A citation must not.
    const reading = metricReading(
      span({
        metricId: "merged_prs",
        value: 0,
        components: undefined,
        days: 0,
        unit: "count",
        aggregation: "sum",
      }),
      "2020-01-01..2020-01-07",
    );

    expect(reading).toEqual({
      status: "no_data",
      window: "2020-01-01..2020-01-07",
      from: "2026-09-11",
      to: "2026-10-10",
      reason: "merged_prs has nothing recorded on any day of 2020-01-01..2020-01-07",
    });
    expect(numbersIn(reading)).toEqual([]);
  });

  it("is no data for a rate with days but no denominator", () => {
    const reading = metricReading(
      span({ value: null, components: undefined, days: 3 }),
      "2026-09-11..2026-10-10",
    );

    expect(reading.status).toBe("no_data");
    expect(numbersIn(reading)).toEqual([]);
  });

  it("keeps a real zero as a zero — a day that recorded 0 merges did record", () => {
    const reading = metricReading(
      span({ value: 0, components: { numerator: 0, denominator: 12 } }),
      "2026-09-11..2026-10-10",
    );

    expect(reading).toMatchObject({ status: "ok", value: 0, n: 12 });
  });

  it.each([
    ["pct", "%"],
    ["duration_ms", "ms"],
    ["count", "count"],
    ["cents", "cents"],
    ["tokens", "tokens"],
  ] as const)("prints the registry unit %s as %s", (unit, printed) => {
    expect(metricReading(span({ unit }), "w")).toMatchObject({ unit: printed });
  });
});

describe("a reading of a case metric", () => {
  it("is the median and interquartile range of the measurements taken", () => {
    expect(sampleReading(samples([2.4, 2.4, 2.4, 1.7]), "case:overshoot_pct", WINDOW)).toEqual({
      ...WINDOW,
      status: "ok",
      value: 2.4,
      unit: "%",
      n: 4,
      basis: "samples",
      median: 2.4,
      spread: 0.175,
      spreadKind: "iqr",
    });
  });

  it("is no data, naming the window searched, when nothing was measured", () => {
    const reading = sampleReading([], "case:hover_drift_cm", WINDOW);

    expect(reading).toEqual({
      ...WINDOW,
      status: "no_data",
      reason: "no measurement of case:hover_drift_cm was taken in 2026-10-03..2026-10-10",
    });
    expect(numbersIn(reading)).toEqual([]);
  });

  it("refuses to pool two units into one median", () => {
    const reading = sampleReading(
      [...samples([31], "cm"), ...samples([310], "mm")],
      "case:hover_drift",
      WINDOW,
    );

    expect(reading.status).toBe("no_data");
    expect((reading as { reason: string }).reason).toMatch(/more than one unit.*cm, mm/);
  });
});

describe("a reading of a baseline", () => {
  const stored = {
    releaseTag: "v2.0.4",
    n: 48,
    median: 31,
    spread: 4.2,
    spreadKind: "iqr",
    unit: "cm",
    from: "2026-07-25T02:35:47Z",
    to: "2026-08-01T02:35:47Z",
  };

  it("is the release's stored statistics, over the window it was captured in", () => {
    expect(baselineReading(stored, "case:hover_drift_cm", "baseline:v2.0.4", "v2.0.4")).toEqual({
      status: "ok",
      window: "baseline:v2.0.4",
      from: "2026-07-25T02:35:47Z",
      to: "2026-08-01T02:35:47Z",
      value: 31,
      unit: "cm",
      n: 48,
      basis: "baseline",
      median: 31,
      spread: 4.2,
      spreadKind: "iqr",
    });
  });

  it("is no data for a release that captured none", () => {
    const reading = baselineReading(undefined, "merge_rate", "baseline:v9.9.9", "v9.9.9");

    expect(reading).toEqual({
      status: "no_data",
      window: "baseline:v9.9.9",
      from: null,
      to: null,
      reason: "no baseline of merge_rate was captured for release v9.9.9",
    });
  });
});

describe("comparing two readings", () => {
  const baseline = baselineReading(
    {
      releaseTag: "v2.0.4",
      n: 48,
      median: 31,
      spread: 4.2,
      spreadKind: "iqr",
      unit: "cm",
      from: "a",
      to: "b",
    },
    "m",
    "baseline:v2.0.4",
    "v2.0.4",
  ) as OkReading;
  const nightly = sampleReading(
    samples([34.84, 35.84, 34.84, 35.84], "cm"),
    "m",
    WINDOW,
  ) as OkReading;

  it("returns the signed delta with its unit — the watch's +14%", () => {
    expect(compareReadings(baseline, nightly)).toEqual({
      status: "ok",
      unit: "cm",
      delta: 4.34,
      deltaPct: 14,
      display: "+14% (+4.34 cm)",
    });
    // Both windows' sample counts travel with the readings themselves.
    expect([baseline.n, nightly.n]).toEqual([48, 4]);
  });

  it("is negative when the second window is lower", () => {
    expect(compareReadings(nightly, baseline)).toMatchObject({ status: "ok", delta: -4.34 });
    expect((compareReadings(nightly, baseline) as { display: string }).display).toMatch(/^−/);
  });

  it("moves a percentage metric in points, not percent of percent", () => {
    const a = metricReading(
      span({ value: 88.88888888888889, components: { numerator: 96, denominator: 108 } }),
      "a",
    ) as OkReading;
    const b = metricReading(span(), "b") as OkReading;

    expect(compareReadings(a, b)).toEqual({
      status: "ok",
      unit: "%",
      delta: 2.9478,
      deltaPct: 3.3163,
      display: "+2.9478 pts",
    });
  });

  it("prints the absolute delta alone when there is no percentage from zero", () => {
    const zero = sampleReading(samples([0, 0], "count"), "m", WINDOW) as OkReading;
    const some = sampleReading(samples([37, 37], "count"), "m", WINDOW) as OkReading;

    expect(compareReadings(zero, some)).toMatchObject({
      delta: 37,
      deltaPct: null,
      display: "+37 count",
    });
  });

  it.each([
    ["the first window", sampleReading([], "m", WINDOW), nightly],
    ["the second window", baseline, sampleReading([], "m", WINDOW)],
    [
      "both windows",
      sampleReading([], "m", WINDOW),
      baselineReading(undefined, "m", "baseline:x", "x"),
    ],
  ])("is no data — no delta at all — when %s is empty", (_what, a, b) => {
    const comparison = compareReadings(a, b);

    expect(comparison.status).toBe("no_data");
    expect(comparison).not.toHaveProperty("delta");
    expect(comparison).not.toHaveProperty("deltaPct");
    expect((comparison as { reason: string }).reason).toMatch(/^nothing to compare: /);
  });

  it("names every empty side in the reason", () => {
    const comparison = compareReadings(
      sampleReading([], "m", WINDOW),
      baselineReading(undefined, "m", "baseline:x", "x"),
    ) as { reason: string };

    expect(comparison.reason).toMatch(
      /no measurement of m was taken.*; no baseline of m was captured/,
    );
  });

  it("refuses to subtract two units", () => {
    const pct = sampleReading(samples([2.4]), "m", WINDOW) as OkReading;

    expect(compareReadings(baseline, pct)).toEqual({
      status: "no_data",
      reason: "the two windows are in different units (cm and %), so they have no difference",
    });
  });
});

describe("a reading in a sentence", () => {
  it("states a rate with its n and what the n counts", () => {
    expect(readingSentence("merge_rate", metricReading(span(), "2026-09-11..2026-10-10"))).toBe(
      "merge_rate = 91.83673469387755% over 2026-09-11..2026-10-10 (n = 98, denominator)",
    );
  });

  it("states a sample with its median, spread and n", () => {
    expect(
      readingSentence("overshoot", sampleReading(samples([2.4, 2.4, 2.4, 1.7]), "m", WINDOW)),
    ).toBe("overshoot: median 2.4% (iqr 0.175, n = 4 samples) over 2026-10-03..2026-10-10");
  });

  it("says no data, and that it is not zero", () => {
    expect(readingSentence("m", sampleReading([], "m", WINDOW))).toBe(
      "No data — no measurement of m was taken in 2026-10-03..2026-10-10. Not zero: nothing was measured.",
    );
  });
});
