/**
 * Stand-ins for the windowed metrics service (BJ.1,
 * [#437](https://github.com/NobuData/ouroboros/issues/437)), for the specs of its consumers.
 *
 * Not shipped: `*.fixture.ts` is excluded from the build.
 */

import type { MetricsService } from "./metrics.service";
import type { MetricScope, MetricWindow } from "./metrics.types";

/**
 * A window with plausible defaults, overridden by the test.
 *
 * @param metricId - The metric.
 * @param overrides - What the test cares about.
 * @returns The window.
 */
export function metricWindow(
  metricId: string,
  overrides: Partial<MetricWindow> = {},
): MetricWindow {
  return {
    metricId,
    range: "7d",
    from: "2026-08-07",
    to: "2026-08-13",
    value: 0,
    prior: 0,
    delta: 0,
    series: [],
    methodology: {
      metricId,
      title: metricId,
      formula: `${metricId} formula`,
      sources: ["runs"],
      caveats: "none",
      unit: "count",
      version: 1,
      proxy: false,
      aggregation: "sum",
    },
    ...overrides,
  };
}

/** A `MetricsService` whose `window` is a mock, for assertions on how it was called. */
export type MetricsStub = MetricsService & {
  window: jest.Mock<Promise<MetricWindow>, [string, MetricScope]>;
};

/**
 * A metrics service answering each metric with a stated window.
 *
 * @param windows - The window per metric id; a metric not listed answers an empty window.
 * @returns The stub.
 */
export function metricsAnswering(
  windows: Readonly<Record<string, Partial<MetricWindow>>> = {},
): MetricsStub {
  return {
    window: jest.fn((metricId: string) =>
      Promise.resolve(metricWindow(metricId, windows[metricId])),
    ),
  } as unknown as MetricsStub;
}
