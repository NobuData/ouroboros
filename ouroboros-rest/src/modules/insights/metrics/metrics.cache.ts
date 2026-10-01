/**
 * The windowed metrics service's short-TTL cache (BJ.1,
 * [#437](https://github.com/NobuData/ouroboros/issues/437)).
 *
 * The Insights page draws eleven visuals and the dashboard polls every fifteen seconds. Both ask
 * the same few windows again and again, and the answer does not change between two polls.
 *
 * **Keyed by workspace, metric, scope, range, today and the rollup stamp.**
 *
 *   * Workspace first, so one workspace's figures can never answer another's request.
 *   * Today, so a cached window does not survive midnight UTC: the window moves at the day
 *     boundary even when no row is written.
 *   * The rollup stamp (`MetricsRepository.stamp`), so a window cached before a rollup refresh is
 *     never served after one, on this replica or any other. A refresh changes the stamp, and the
 *     next request misses.
 *
 * The TTL bounds how long the live tail can lag: a merge that lands mid-window appears within
 * {@link METRICS_CACHE_TTL_MS}.
 */

import { Injectable } from "@nestjs/common";

import type { MetricWindow } from "./metrics.types";

/** How long a window is reused: thirty seconds, twice the shell's fifteen-second poll. */
export const METRICS_CACHE_TTL_MS = 30_000;

/** How many windows are held before the oldest go. A bound, not a target. */
export const METRICS_CACHE_MAX_ENTRIES = 2_048;

/** Everything a cached window is keyed by. */
export interface MetricsCacheKey {
  readonly organizationId: string;
  readonly stamp: string;
  readonly metricId: string;
  readonly repo?: string;
  readonly dimension?: string;
  readonly range: string;
  readonly today: string;
}

/** One remembered window. */
interface CacheEntry {
  readonly organizationId: string;
  readonly window: MetricWindow;
  /** `Date.now()` after which the entry is not served. */
  readonly expiresAt: number;
}

@Injectable()
export class MetricsCache {
  /** Key to entry, in insertion order, which is also the eviction order. */
  private readonly entries = new Map<string, CacheEntry>();

  /**
   * The window remembered for a key, if it is still fresh.
   *
   * @param key - The key.
   * @returns The window, or undefined.
   */
  get(key: MetricsCacheKey): MetricWindow | undefined {
    const id = keyOf(key);
    const entry = this.entries.get(id);

    if (entry === undefined) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(id);
      return undefined;
    }

    return entry.window;
  }

  /**
   * Remember a window.
   *
   * @param key - The key.
   * @param window - The window.
   */
  set(key: MetricsCacheKey, window: MetricWindow): void {
    const id = keyOf(key);

    // Deleted first so a rewrite moves the key to the back of the eviction order.
    this.entries.delete(id);
    this.entries.set(id, {
      organizationId: key.organizationId,
      window,
      expiresAt: Date.now() + METRICS_CACHE_TTL_MS,
    });

    this.evict();
  }

  /**
   * Forget every window of a workspace. Nothing needs it for correctness — the rollup stamp in the
   * key already retires a refreshed workspace's windows — but a writer in this process that wants
   * its change visible before the TTL can call it.
   *
   * @param organizationId - The workspace.
   * @returns How many entries were dropped.
   */
  invalidate(organizationId: string): number {
    let dropped = 0;

    for (const [id, entry] of this.entries) {
      if (entry.organizationId === organizationId) {
        this.entries.delete(id);
        dropped += 1;
      }
    }

    return dropped;
  }

  /** How many entries are held, expired ones included. For the suites. */
  get size(): number {
    return this.entries.size;
  }

  /** Drop expired entries, then the oldest, until under the bound. */
  private evict(): void {
    if (this.entries.size <= METRICS_CACHE_MAX_ENTRIES) {
      return;
    }

    const now = Date.now();

    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(id);
      }
    }

    for (const id of this.entries.keys()) {
      if (this.entries.size <= METRICS_CACHE_MAX_ENTRIES) {
        break;
      }
      this.entries.delete(id);
    }
  }
}

/**
 * A key as one string. JSON rather than a separator, so no part can collide with another.
 *
 * @param key - The key.
 * @returns Its string form.
 */
function keyOf(key: MetricsCacheKey): string {
  return JSON.stringify([
    key.organizationId,
    key.stamp,
    key.metricId,
    key.repo ?? null,
    key.dimension ?? null,
    key.range,
    key.today,
  ]);
}
