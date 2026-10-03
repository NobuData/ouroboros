import {
  annotatedRun,
  CCACHE_SHA,
  changePoint,
  POLICY_VERSION_ID,
  resolvedEvidence,
} from "./duration.fixture";
import {
  ATTRIBUTION_WINDOW_DAYS,
  changePointResource,
  durationChartResource,
  durationPointResource,
  emptyDurationChart,
} from "./duration.resources";

/**
 * What the duration chart publishes of a stored finding (BW.2, #517): the ranking with its scores,
 * never a single cause; nothing a finding did not record; and every reference resolved to the
 * surface it opens on, or to nothing.
 */

describe("a change-point finding, as the chart reads it", () => {
  const resource = changePointResource(changePoint(), resolvedEvidence());

  it("publishes the detected day, the measured delta and both segment medians", () => {
    expect(resource).toMatchObject({
      id: "5eed0066-0000-4000-8000-000000000102",
      analyzerVersion: 1,
      date: "2026-06-22",
      metric: "build.duration_median",
      deltaSeconds: -130,
      beforeMedianSeconds: 342,
      afterMedianSeconds: 212,
    });
  });

  it("publishes every candidate in its stored rank, with its score and the score's factors", () => {
    expect(resource.candidates).toEqual([
      {
        label: "ccache enabled",
        score: 0.7,
        eventKind: "merge",
        date: "2026-06-22",
        daysFromBreakpoint: 0,
        proximity: 1,
        prior: 0.7,
        ref: { kind: "merge", id: CCACHE_SHA },
      },
      {
        label: "standard-fix v9",
        score: 0.3,
        eventKind: "policy_version",
        date: "2026-06-21",
        daysFromBreakpoint: -1,
        proximity: 0.75,
        prior: 0.4,
        ref: { kind: "workflow_version", id: POLICY_VERSION_ID },
      },
    ]);
  });

  it("states the attribution window of the analyzer version that ranked them", () => {
    expect(ATTRIBUTION_WINDOW_DAYS[1]).toBe(3);
    expect(resource.attributionWindowDays).toBe(3);
  });

  it("states no window for a version it does not know, rather than assuming one", () => {
    const later = changePointResource(changePoint({ analyzer_version: 7 }), resolvedEvidence());

    expect(later.attributionWindowDays).toBeNull();
  });

  it("publishes the confidence with the basis it was computed from", () => {
    expect(resource.confidence).toBe(100);
    expect(resource.confidenceBasis).toEqual({
      method: expect.stringContaining("change_point v1") as string,
      sampleSize: 642,
      effectSize: 17.537,
      stability: 1,
    });
  });

  it("reads a key V081 does not require as null when the finding lacks it — never a default", () => {
    const bare = changePointResource(
      changePoint({
        data: {
          date: "2026-06-22",
          metric: "build.duration_median",
          delta_seconds: 40,
          candidates: [{ label: "a merge", score: 0.5, ref: { kind: "merge", id: CCACHE_SHA } }],
        },
        confidence_basis: {},
      }),
      resolvedEvidence(),
    );

    expect(bare.beforeMedianSeconds).toBeNull();
    expect(bare.afterMedianSeconds).toBeNull();
    expect(bare.candidates[0]).toMatchObject({
      eventKind: null,
      date: null,
      daysFromBreakpoint: null,
      proximity: null,
      prior: null,
    });
    expect(bare.confidenceBasis).toEqual({
      method: null,
      sampleSize: null,
      effectSize: null,
      stability: null,
    });
  });
});

describe("a change-point's evidence", () => {
  it("keeps the finding's references in their stored order, each resolved or not", () => {
    const { evidence } = changePointResource(changePoint(), resolvedEvidence());

    expect(evidence.map((entry) => `${entry.kind}:${String(entry.surface)}`)).toEqual([
      "merge:pull_request",
      "workflow_version:workflow",
      "build:farm",
      "build:null",
    ]);
  });
});

describe("the series", () => {
  it("turns BI's millisecond median into seconds, and counts the day's builds", () => {
    expect(
      durationPointResource({
        day: "2026-06-22",
        dimension: "zephyr build",
        value: 212_400,
        samples: [200_000, 212_400, 230_000],
      }),
    ).toEqual({ day: "2026-06-22", medianSeconds: 212.4, builds: 3 });
  });
});

describe("the chart", () => {
  it("is the run's: its window, its duration label, its findings", () => {
    const chart = durationChartResource(
      annotatedRun(),
      [{ day: "2026-06-22", dimension: "zephyr build", value: 212_000, samples: [212_000] }],
      [changePoint()],
      resolvedEvidence(),
    );

    expect(chart).toMatchObject({
      repo: "acme-robotics/helios-firmware",
      runId: "5eed0065-0000-4000-8000-000000000002",
      analyzedAt: "2026-08-08T10:41:00.000Z",
      durationLabel: "zephyr build",
      window: { from: "2026-05-10", to: "2026-08-07", days: 90 },
      series: [{ day: "2026-06-22", medianSeconds: 212, builds: 1 }],
    });
    expect(chart.changePoints.map((point) => point.date)).toEqual(["2026-06-22"]);
  });

  it("is empty — no run, no window, no chips — before a run has detected change-points", () => {
    expect(emptyDurationChart("acme-robotics/atlas-scheduler")).toEqual({
      repo: "acme-robotics/atlas-scheduler",
      runId: null,
      analyzedAt: null,
      durationLabel: null,
      window: null,
      series: [],
      changePoints: [],
    });
  });
});
