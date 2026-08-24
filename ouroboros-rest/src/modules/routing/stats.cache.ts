/**
 * The short-TTL stats cache — the ticket's *cache with a short TTL, keyed per organization and
 * window; the matrix payload should not re-aggregate on every poll*
 * ([#198](https://github.com/NobuData/ouroboros/issues/198)).
 *
 * The routing page is one screen that polls, and every poll asks the same two questions of the
 * same thirty days: *what did each kind of work cost and how long did it take*, and *what was
 * each provider paid*. Both are grouped aggregates over a workspace's whole ledger window —
 * three hundred and seventy rows in the seeded workspace and a great many more in a real one —
 * and the answer does not change between two polls a few seconds apart. That is what this
 * collapses.
 *
 * ---------------------------------------------------------------------------
 * **Three decisions, each of which is a way this could have been wrong.**
 *
 * **1. The whole snapshot is one entry, not one entry per figure.** The matrix's numerics, the
 * spend card and the footnote are aggregates over one window, and caching them separately would
 * let two of them expire at different moments — so a page could show a call inside the card's
 * total and outside the matrix's average, which is precisely the inconsistency
 * `stats.window.ts` computes one boundary to prevent.
 *
 * **2. A cached snapshot keeps the window it was measured over.** `window.until` is the instant
 * the aggregation ran at, not the instant it was served, so a client is told what it is actually
 * looking at. Refreshing that label on the way out would make a stale answer claim to be fresh,
 * which is the one property a cache must never add.
 *
 * **3. There is no invalidation, only the TTL.** Nothing in this process writes `token_usage` —
 * spend is appended by the engine as calls happen, and by Flyway when a developer seeds — so
 * there is no save to hang an invalidation on, the way `PricingCache` hangs one on an override
 * write. {@link STATS_CACHE_TTL_MS} is therefore the honest bound on how long a fresh run can
 * take to appear, and it is chosen to be short for that reason rather than tuned for a hit rate.
 *
 * ---------------------------------------------------------------------------
 * **Why thirty seconds.** The routing page polls on the shell's cadence, which
 * `ouroboros-ui`'s `DEFAULT_POLL_SECONDS` sets to fifteen. A TTL at the poll interval would
 * re-aggregate on essentially every poll — the criterion's *"long enough that matrix polling
 * does not re-aggregate each time"* failed by a hair — and a TTL of minutes would leave a run
 * that has just finished invisible for longer than somebody watching it would tolerate. Twice
 * the poll interval is the smallest number that satisfies both, and it is the same figure
 * `PRICE_CACHE_TTL_MS` settles on for the same shape of question.
 */

import { Injectable } from "@nestjs/common";

import type { RoutingStatsSnapshot } from "./stats";

/**
 * How long a snapshot is reused — thirty seconds.
 *
 * Both halves of the acceptance criterion, and this file's header argues the arithmetic: long
 * enough that a page polling every fifteen seconds re-aggregates at most every other poll, and
 * short enough that a run which has just finished shows up within half a minute.
 */
export const STATS_CACHE_TTL_MS = 30_000;

/**
 * How many snapshots are held before the oldest are dropped.
 *
 * A bound rather than a target. One entry per workspace per window, and a process serves a
 * bounded number of workspaces at a time; this exists so a deployment with a great many of them
 * cannot grow the map for as long as the process lives. Eviction is insertion-ordered, which
 * `Map` gives for free and which is the right order for a burst absorber this small.
 */
export const STATS_CACHE_MAX_ENTRIES = 1_024;

/**
 * The separator between the two parts of a key.
 *
 * A colon, because neither part can contain one: a workspace id is a `gen_random_uuid()::text`
 * and a window width is digits. A separator either part could hold would let two keys collide,
 * which is one workspace's spend shown to another.
 */
const KEY_SEPARATOR = ":";

/** One remembered snapshot, and when it stops being reusable. */
interface CacheEntry {
  /** The answer, with the window it was measured over — see decision 2 above. */
  readonly snapshot: RoutingStatsSnapshot;
  /** `Date.now()` after which this entry is no longer served. */
  readonly expiresAt: number;
}

@Injectable()
export class RoutingStatsCache {
  /** Key to entry, in insertion order, which is also the eviction order. */
  private readonly entries = new Map<string, CacheEntry>();

  /**
   * The snapshot remembered for this workspace and window, if one still is.
   *
   * @param organizationId - The workspace asking. Part of the key because the whole of this
   *   payload is one workspace's money — the isolation criterion, at the cache as well as in
   *   the SQL.
   * @param windowDays - How wide the window was. Part of the key because AB.4
   *   ([#210](https://github.com/NobuData/ouroboros/issues/210)) will ask for other spans, and a
   *   cache keyed only by workspace would answer a ninety-day question with a thirty-day total.
   * @returns The snapshot, or `undefined` when nothing is remembered or what was has expired.
   */
  get(organizationId: string, windowDays: number): RoutingStatsSnapshot | undefined {
    const key = cacheKey(organizationId, windowDays);
    const entry = this.entries.get(key);

    if (entry === undefined) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      // Dropped rather than left to the eviction bound: an expired entry that stays in the map
      // holds a key that a later `set` would re-insert at the *old* position, which would make
      // it evictable before entries written long after it.
      this.entries.delete(key);
      return undefined;
    }

    return entry.snapshot;
  }

  /**
   * Remember a snapshot.
   *
   * @param organizationId - The workspace.
   * @param windowDays - How wide the window was.
   * @param snapshot - What the aggregation answered.
   */
  set(organizationId: string, windowDays: number, snapshot: RoutingStatsSnapshot): void {
    const key = cacheKey(organizationId, windowDays);

    // Deleted first so a re-write moves the key to the back of the insertion order. Without
    // this, refreshing a hot key would leave it at its original position and evict it ahead of
    // colder ones.
    this.entries.delete(key);
    this.entries.set(key, { snapshot, expiresAt: Date.now() + STATS_CACHE_TTL_MS });

    this.evict();
  }

  /**
   * Forget everything this workspace was told.
   *
   * Nothing in this service calls it today — decision 3 above — and it is here as the seam for
   * the moment something in this process does write the ledger, so that path has somewhere to
   * say so rather than a reason to shorten the TTL for everybody.
   *
   * @param organizationId - The workspace whose spend just changed.
   * @returns How many entries were dropped. Returned so a suite can assert a write reached the
   *   cache, rather than that a later read happened to miss.
   */
  invalidate(organizationId: string): number {
    const prefix = `${organizationId}${KEY_SEPARATOR}`;
    let dropped = 0;

    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        dropped += 1;
      }
    }

    return dropped;
  }

  /** How many entries are held, expired ones included. For the suite and for nothing else. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Bring the map back under {@link STATS_CACHE_MAX_ENTRIES}.
   *
   * Expired entries go first — they are free to drop and dropping them is not a loss — and only
   * if that is not enough does anything still valid go, oldest first.
   */
  private evict(): void {
    if (this.entries.size <= STATS_CACHE_MAX_ENTRIES) {
      return;
    }

    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }

    for (const key of this.entries.keys()) {
      if (this.entries.size <= STATS_CACHE_MAX_ENTRIES) {
        break;
      }
      this.entries.delete(key);
    }
  }
}

/**
 * The two parts of a key, as one string.
 *
 * The workspace leads so {@link RoutingStatsCache.invalidate} can find its entries by prefix —
 * the one operation that has to enumerate a subset, and the reason the key is a string rather
 * than a nested map.
 *
 * @param organizationId - The workspace.
 * @param windowDays - How wide the window is.
 * @returns The key.
 */
function cacheKey(organizationId: string, windowDays: number): string {
  return `${organizationId}${KEY_SEPARATOR}${windowDays}`;
}
