import {
  METRICS_CACHE_MAX_ENTRIES,
  METRICS_CACHE_TTL_MS,
  MetricsCache,
  type MetricsCacheKey,
} from "./metrics.cache";
import { metricWindow } from "./metrics.fixture";

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
});
