import {
  annotatedRun,
  CCACHE_SHA,
  changePoint,
  FIRST_AFTER_ID,
  LAST_BEFORE_ID,
  POLICY_VERSION_ID,
  resolvedEvidence,
} from "./duration.fixture";
import {
  ATTRIBUTION_WINDOW_DAYS,
  changePointResource,
  durationChartResource,
  durationPointResource,
  emptyDurationChart,
  evidenceIds,
  evidenceResource,
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

describe("evidence references", () => {
  it("are grouped by the kinds this read opens, each id once", () => {
    const ids = evidenceIds([
      changePoint(),
      changePoint({
        evidence_refs: [
          { kind: "merge", id: CCACHE_SHA },
          { kind: "runner_pool", id: "pool-1" },
          { kind: "runner", id: "runner-1" },
          { kind: "waiver", id: "waiver-1" },
        ],
      }),
    ]);

    expect(ids).toEqual({
      builds: [LAST_BEFORE_ID, FIRST_AFTER_ID],
      merges: [CCACHE_SHA],
      workflowVersions: [POLICY_VERSION_ID],
      runnerPools: ["pool-1"],
      runners: ["runner-1"],
    });
  });

  it("open a merge on its mirrored pull request", () => {
    expect(evidenceResource({ kind: "merge", id: CCACHE_SHA }, resolvedEvidence())).toEqual({
      kind: "merge",
      id: CCACHE_SHA,
      label: "ccache enabled",
      surface: "pull_request",
      pullRequestId: "5eed0052-0000-4000-8000-000000000482",
      workflowSlug: null,
    });
  });

  it("open a merge the mirror has no PR for on the farm that built it", () => {
    const resolved = resolvedEvidence({
      merges: [{ sha: CCACHE_SHA, title: "ccache enabled", pull_request_id: null }],
    });

    expect(evidenceResource({ kind: "merge", id: CCACHE_SHA }, resolved)).toMatchObject({
      label: "ccache enabled",
      surface: "farm",
      pullRequestId: null,
    });
  });

  it("open a workflow version in the studio, a draft named as one", () => {
    const ref = { kind: "workflow_version", id: POLICY_VERSION_ID };

    expect(evidenceResource(ref, resolvedEvidence())).toMatchObject({
      label: "standard-fix v9",
      surface: "workflow",
      workflowSlug: "standard-fix",
    });
    expect(
      evidenceResource(
        ref,
        resolvedEvidence({
          workflowVersions: [{ id: POLICY_VERSION_ID, slug: "standard-fix", version: null }],
        }),
      ).label,
    ).toBe("standard-fix draft");
  });

  it("open a build, a pool and a runner on the farm", () => {
    const resolved = resolvedEvidence({
      runnerPools: [{ id: "pool-1", name: "pool-a" }],
      runners: [{ id: "runner-1", name: "forge-02" }],
    });

    expect(evidenceResource({ kind: "build", id: LAST_BEFORE_ID }, resolved)).toMatchObject({
      label: "#641 · zephyr build",
      surface: "farm",
    });
    expect(evidenceResource({ kind: "runner_pool", id: "pool-1" }, resolved)).toMatchObject({
      label: "pool-a",
      surface: "farm",
    });
    expect(evidenceResource({ kind: "runner", id: "runner-1" }, resolved)).toMatchObject({
      label: "forge-02",
      surface: "farm",
    });
  });

  it.each([
    ["a build retention has removed", { kind: "build", id: FIRST_AFTER_ID }],
    ["a merge nothing in the workspace recorded", { kind: "merge", id: "feedbee" }],
    ["a pool that is gone", { kind: "runner_pool", id: "pool-9" }],
    ["a kind this read opens nowhere", { kind: "test_case", id: "case-1" }],
  ])("leave %s named by its reference alone, opening nothing", (_about, ref) => {
    expect(evidenceResource(ref, resolvedEvidence())).toEqual({
      ...ref,
      label: null,
      surface: null,
      pullRequestId: null,
      workflowSlug: null,
    });
  });

  it("keep a finding's references in their stored order", () => {
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
