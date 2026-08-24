import { RoutingStatsCache, STATS_CACHE_MAX_ENTRIES, STATS_CACHE_TTL_MS } from "./stats.cache";
import type { RoutingStatsSnapshot } from "./stats";

/**
 * The cache, and the acceptance criterion it is measured against: *"cache TTL is short enough
 * that a fresh run appears promptly and long enough that matrix polling does not re-aggregate
 * each time"*.
 *
 * Both halves are asserted rather than argued. The page polls on the shell's fifteen-second
 * cadence, so *does not re-aggregate each time* is the property that a second read inside that
 * interval is served from memory, and *appears promptly* is the property that the entry is gone
 * within half a minute. Fake timers are what make the second one a test rather than a comment.
 *
 * The rest is the isolation criterion at the cache: a snapshot is one workspace's money, and a
 * key that could be shared is that money shown to somebody else.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const OTHER = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

/**
 * A snapshot with nothing in it — identity is what the assertions are about, not content.
 *
 * @param marker - Something to tell two of them apart by.
 * @returns The snapshot.
 */
function snapshot(marker: number): RoutingStatsSnapshot {
  return {
    byTaskKind: new Map(),
    spend: { tokens: marker } as unknown as RoutingStatsSnapshot["spend"],
  };
}

describe("the routing stats cache", () => {
  let cache: RoutingStatsCache;

  beforeEach(() => {
    cache = new RoutingStatsCache();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("remembers nothing it was not told", () => {
    expect(cache.get(WORKSPACE, 30)).toBeUndefined();
  });

  it("serves a second read from memory rather than re-aggregating", () => {
    // The polling half of the criterion: a page asking again a few seconds later gets the same
    // object, so the ledger is not grouped twice for one screen.
    const first = snapshot(1);
    cache.set(WORKSPACE, 30, first);

    expect(cache.get(WORKSPACE, 30)).toBe(first);
  });

  it("forgets an entry once the TTL has passed", () => {
    // The freshness half: a run that has just finished cannot stay invisible for longer than
    // this. Asserted with fake timers because a comment claiming thirty seconds is not a bound.
    jest.useFakeTimers();
    cache.set(WORKSPACE, 30, snapshot(1));

    jest.advanceTimersByTime(STATS_CACHE_TTL_MS - 1);
    expect(cache.get(WORKSPACE, 30)).toBeDefined();

    jest.advanceTimersByTime(1);
    expect(cache.get(WORKSPACE, 30)).toBeUndefined();
  });

  it("drops an expired entry rather than leaving it to the eviction bound", () => {
    jest.useFakeTimers();
    cache.set(WORKSPACE, 30, snapshot(1));
    jest.advanceTimersByTime(STATS_CACHE_TTL_MS);

    cache.get(WORKSPACE, 30);

    expect(cache.size).toBe(0);
  });

  it("is long enough that a page polling every fifteen seconds does not re-aggregate each time", () => {
    // `ouroboros-ui`'s `DEFAULT_POLL_SECONDS` is fifteen. Stated as an arithmetic assertion so
    // that shortening the TTL to the poll interval fails here rather than in a profile.
    expect(STATS_CACHE_TTL_MS).toBeGreaterThan(15_000);
    expect(STATS_CACHE_TTL_MS).toBeLessThanOrEqual(60_000);
  });

  it("does not answer one workspace with another's snapshot", () => {
    // The isolation criterion, at the cache. The SQL carries the workspace too; this is the
    // other place a total could cross a boundary, and it would look entirely plausible.
    cache.set(WORKSPACE, 30, snapshot(1));

    expect(cache.get(OTHER, 30)).toBeUndefined();
  });

  it("does not answer a wider window with a narrower window's totals", () => {
    // AB.4 (#210) will ask for other spans. A cache keyed only by workspace would answer a
    // ninety-day question with a thirty-day total, which is a smaller invoice than the truth.
    cache.set(WORKSPACE, 30, snapshot(1));

    expect(cache.get(WORKSPACE, 90)).toBeUndefined();
  });

  it("replaces a snapshot rather than keeping two for one key", () => {
    cache.set(WORKSPACE, 30, snapshot(1));
    cache.set(WORKSPACE, 30, snapshot(2));

    expect(cache.size).toBe(1);
    expect(cache.get(WORKSPACE, 30)?.spend.tokens).toBe(2);
  });

  it("forgets one workspace's entries and leaves every other workspace alone", () => {
    cache.set(WORKSPACE, 30, snapshot(1));
    cache.set(WORKSPACE, 90, snapshot(2));
    cache.set(OTHER, 30, snapshot(3));

    expect(cache.invalidate(WORKSPACE)).toBe(2);
    expect(cache.get(OTHER, 30)).toBeDefined();
  });

  it("stays bounded however many workspaces ask", () => {
    // A deployment serving a great many workspaces must not grow this map for as long as the
    // process lives.
    for (let index = 0; index <= STATS_CACHE_MAX_ENTRIES; index += 1) {
      cache.set(`workspace-${index}`, 30, snapshot(index));
    }

    expect(cache.size).toBeLessThanOrEqual(STATS_CACHE_MAX_ENTRIES);
    // Insertion-ordered eviction: the oldest key is the one that went.
    expect(cache.get("workspace-0", 30)).toBeUndefined();
    expect(cache.get(`workspace-${STATS_CACHE_MAX_ENTRIES}`, 30)).toBeDefined();
  });
});
