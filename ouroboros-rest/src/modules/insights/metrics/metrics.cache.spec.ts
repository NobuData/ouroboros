import {
  METRICS_CACHE_MAX_ENTRIES,
  METRICS_CACHE_TTL_MS,
  MetricsCache,
  type MetricsCacheKey,
} from "./metrics.cache";
import { metricWindow } from "./metrics.fixture";
import type { MetricBreakdown } from "./metrics.types";

/** The window cache (BJ.1, #437): TTL, key isolation, refresh invalidation, bound. */

const KEY: MetricsCacheKey = {
  organizationId: "org-a",
  stamp: "8 2026-09-01 10:00",
  metricId: "merge_rate",
  range: "30d",
  today: "2026-09-01",
};

describe("the metrics cache", () => {
  let cache: MetricsCache;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-09-01T12:00:00.000Z") });
    cache = new MetricsCache();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("serves a window until its TTL, then misses", () => {
    const window = metricWindow("merge_rate");
    cache.set(KEY, window);

    jest.advanceTimersByTime(METRICS_CACHE_TTL_MS - 1);
    expect(cache.get(KEY)).toBe(window);

    jest.advanceTimersByTime(1);
    expect(cache.get(KEY)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it.each<[string, Partial<MetricsCacheKey>]>([
    ["another workspace", { organizationId: "org-b" }],
    ["a rollup refresh (a new stamp)", { stamp: "8 2026-09-01 11:00" }],
    ["another metric", { metricId: "merged_prs" }],
    ["another repository", { repo: "acme/helios" }],
    ["another dimension", { dimension: "infra_rig" }],
    ["another range", { range: "7d" }],
    ["another day", { today: "2026-09-02" }],
  ])("misses for %s", (_, change) => {
    cache.set(KEY, metricWindow("merge_rate"));

    expect(cache.get({ ...KEY, ...change })).toBeUndefined();
  });

  it("keeps a repository-scoped window apart from the workspace's", () => {
    const workspace = metricWindow("merge_rate", { value: 90 });
    const repo = metricWindow("merge_rate", { value: 50 });

    cache.set(KEY, workspace);
    cache.set({ ...KEY, repo: "acme/helios" }, repo);

    expect(cache.get(KEY)).toBe(workspace);
    expect(cache.get({ ...KEY, repo: "acme/helios" })).toBe(repo);
  });

  it("forgets one workspace's windows and nobody else's", () => {
    cache.set(KEY, metricWindow("merge_rate"));
    cache.set({ ...KEY, metricId: "merged_prs" }, metricWindow("merged_prs"));
    cache.set({ ...KEY, organizationId: "org-b" }, metricWindow("merge_rate"));

    expect(cache.invalidate("org-a")).toBe(2);
    expect(cache.get(KEY)).toBeUndefined();
    expect(cache.get({ ...KEY, organizationId: "org-b" })).toBeDefined();
  });

  it("stays under its bound, dropping the oldest first", () => {
    for (let i = 0; i <= METRICS_CACHE_MAX_ENTRIES; i += 1) {
      cache.set({ ...KEY, metricId: `m${String(i)}` }, metricWindow(`m${String(i)}`));
    }

    expect(cache.size).toBe(METRICS_CACHE_MAX_ENTRIES);
    expect(cache.get({ ...KEY, metricId: "m0" })).toBeUndefined();
    expect(cache.get({ ...KEY, metricId: `m${String(METRICS_CACHE_MAX_ENTRIES)}` })).toBeDefined();
  });

  describe("breakdowns (#438)", () => {
    /** A breakdown of two causes. */
    const breakdown: MetricBreakdown = {
      metricId: "human_interventions",
      dimensionKind: "cause",
      range: "30d",
      from: "2026-08-03",
      to: "2026-09-01",
      entries: [
        { dimension: "infra_rig", window: metricWindow("human_interventions", { value: 8 }) },
        { dimension: "other", window: metricWindow("human_interventions", { value: 1 }) },
      ],
      methodology: metricWindow("human_interventions").methodology,
    };
    const CAUSES: MetricsCacheKey = { ...KEY, metricId: "human_interventions" };

    it("serves a breakdown until its TTL, then misses", () => {
      cache.setBreakdown(CAUSES, breakdown);

      jest.advanceTimersByTime(METRICS_CACHE_TTL_MS - 1);
      expect(cache.getBreakdown(CAUSES)).toBe(breakdown);

      jest.advanceTimersByTime(1);
      expect(cache.getBreakdown(CAUSES)).toBeUndefined();
    });

    it("never answers a window with a breakdown, or a breakdown with a window", () => {
      const total = metricWindow("human_interventions", { value: 9 });

      cache.set(CAUSES, total);
      cache.setBreakdown(CAUSES, breakdown);

      expect(cache.get(CAUSES)).toBe(total);
      expect(cache.getBreakdown(CAUSES)).toBe(breakdown);
      expect(cache.size).toBe(2);
    });

    it("is every label, so a key's dimension does not split it", () => {
      cache.setBreakdown({ ...CAUSES, dimension: "infra_rig" }, breakdown);

      expect(cache.getBreakdown(CAUSES)).toBe(breakdown);
    });

    it("keeps workspaces, repositories and rollup refreshes apart, and is forgotten with its workspace", () => {
      cache.setBreakdown(CAUSES, breakdown);

      expect(cache.getBreakdown({ ...CAUSES, organizationId: "org-b" })).toBeUndefined();
      expect(cache.getBreakdown({ ...CAUSES, repo: "acme/helios" })).toBeUndefined();
      expect(cache.getBreakdown({ ...CAUSES, stamp: "9 2026-09-01 11:00" })).toBeUndefined();
      expect(cache.invalidate("org-a")).toBe(1);
      expect(cache.getBreakdown(CAUSES)).toBeUndefined();
    });
  });
});
