import type { Impact } from "../composer/composer.types";
import {
  windowValue,
  baselineWindow,
  MEASUREMENT_TARGETS,
  percentile,
  predictedOf,
  type MetricPoint,
} from "./measurement";

/**
 * What an apply freezes for BU.3 (BV.5, #514): the window before the apply, the baseline in the
 * prediction's unit, and the prediction with its calibration — V085's shapes.
 */

/** A day's row. */
function point(value: number, samples: number[] = [], dimension = ""): MetricPoint {
  return { day: "2026-09-20", dimension, value, samples };
}

/** A quantified impact. */
function impact(overrides: Partial<Impact> = {}): Impact {
  return {
    estimate: -125,
    unit: "seconds",
    applies_to: "per build",
    basis: {
      method: "measured",
      description: "the slowdown measured inside each window",
      sample_size: 14,
      formula: "ccache_rewarm v1: -slowdown_seconds",
      inputs: { slowdown_seconds: 168 },
      window: { from: "2026-06-01", to: "2026-08-29", days: 90 },
      calibration: { analyzer: "cache_window", impact_class: "duration_delta", factor: 0.6545 },
      raw: -168,
    },
    ...overrides,
  };
}

describe("the baseline window", () => {
  it("is the N UTC days ending the day before the apply day", () => {
    expect(baselineWindow(new Date("2026-10-02T23:30:00Z"), 14)).toEqual({
      from: "2026-09-18",
      to: "2026-10-01",
    });
  });
});

describe("the baseline value", () => {
  it("pools a median's samples across days and converts milliseconds to seconds", () => {
    const value = windowValue(
      MEASUREMENT_TARGETS.duration_delta,
      [point(250_000, [240_000, 260_000]), point(300_000, [300_000])],
      14,
    );

    expect(value).toBe(260);
  });

  it("reads a p95 from the same samples, as percentile_cont does", () => {
    expect(percentile([1, 2, 3, 4], 0.95)).toBeCloseTo(3.85);
    expect(windowValue(MEASUREMENT_TARGETS.queue_wait, [point(0, [60_000, 600_000])], 14)).toBe(
      573,
    );
  });

  it("states interventions as a weekly rate", () => {
    expect(windowValue(MEASUREMENT_TARGETS.interventions, [point(10), point(4)], 14)).toBe(7);
  });

  it("has no median of nothing, but a sum of nothing is zero", () => {
    expect(windowValue(MEASUREMENT_TARGETS.duration_delta, [], 14)).toBeUndefined();
    expect(windowValue(MEASUREMENT_TARGETS.interventions, [], 14)).toBe(0);
  });
});

describe("the prediction", () => {
  it("freezes the estimate, unit, basis and calibration V085 requires", () => {
    expect(predictedOf(impact())).toEqual({
      delta: -125,
      unit: "seconds",
      basis: {
        method: "measured",
        description: "the slowdown measured inside each window",
        sample_size: 14,
      },
      calibration: { analyzer: "cache_window", impact_class: "duration_delta", factor: 0.6545 },
    });
  });

  it("has nothing to freeze for an unquantified or zero impact", () => {
    expect(predictedOf(impact({ estimate: null }))).toBeUndefined();
    expect(predictedOf(impact({ estimate: 0 }))).toBeUndefined();
  });
});
