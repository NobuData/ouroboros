/**
 * Every number and every boundary the build farm's stat row has an opinion about, in one file.
 *
 * AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)). `farm.policy.ts` does this
 * for the identity layer and `dispatch/dispatch.policy.ts` for dispatch; this is the same file
 * for the page's four cards, and it exists for the same reason: a window computed twice is a
 * window that disagrees with itself.
 *
 * ---------------------------------------------------------------------------
 * **Every stat is a window over history, and the windows have edges.**
 *
 * *Builds today* is a claim about a calendar day, and a calendar needs a zone or a build at
 * 23:58 belongs to a different day depending on who is asking. *▼ 38s vs last week* is a claim
 * about two windows, and it is only a comparison when both of them exist. So the boundaries
 * are computed **once per request**, here, from one `now`, and handed to every statement as
 * parameters — `dashboard/windows.ts` makes the same argument for mockup 02, and
 * `routing/stats.window.ts` for mockup 06.
 *
 * ---------------------------------------------------------------------------
 * **The two windows are calendar windows, not rolling durations, and that is the difference
 * from routing's.**
 *
 * Routing's *30d* is `now − 30 × 24h`: a duration, which needs no zone. *Today* cannot be
 * that, because *today* is a word about a calendar. And *last week* has to be the seven whole
 * days **before** today rather than `now − 7d`, or the two windows would overlap by however
 * far into today it happens to be — today's builds would be in both sides of their own
 * comparison, and the delta would shrink towards zero as the day went on.
 *
 * So: `[dayStart, now]` and `[dayStart − 7 days, dayStart)`. Adjacent, disjoint, and the
 * second one whole.
 */

import { startOfDay } from "../../dashboard/windows";

/**
 * The zone the farm's calendar boundaries are taken in.
 *
 * UTC, and stated as a value rather than assumed because it is published: the OpenAPI
 * description of `GET /api/v1/farm` names it, the payload carries it, and a card reading
 * *23 builds today* beside a person's own clock has to say which day is meant.
 *
 * It follows `dashboard/windows.ts` rather than deciding for itself, and deliberately: a
 * workspace looking at *builds today* on the dashboard and *builds today* on the build farm
 * within a minute of each other must be told about one day. When `workspace_settings` can
 * state a zone, both files take it from there and neither has to be found first.
 */
export const FARM_TIME_ZONE = "UTC";

/** How many whole days *vs last week* looks back over, ending where today begins. */
export const PRIOR_WINDOW_DAYS = 7;

/**
 * What a client is told to wait before reading the page again, in seconds.
 *
 * Ten, which is the **fleet's own cadence** rather than a number chosen here: a runner
 * heartbeats every `HEARTBEAT_INTERVAL_MS` (`gateway/gateway.policy.ts`), so a page polling
 * faster would redraw telemetry that has not moved. ARCHITECTURE 5.4's polling contract puts
 * the cadence on the server for the reason `dashboard.controller.ts` gives: a deployment
 * under load slows every open page down within one cycle, with nothing shipped to a client.
 */
export const FARM_POLL_SECONDS = 10;

/** Milliseconds in a day. A duration used to step whole days back from a calendar boundary. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How the cache is shared across the fleet — decision **B5**, and the half of the cache
 * card's label that is not a fact about ccache.
 *
 * ---------------------------------------------------------------------------
 * **Mockup 08 reads `ccache · shared per pool`, and for this release that would be a lie.**
 *
 * B5 scopes the MVP's caches to one per runner: AG.4's ([#246](https://github.com/NobuData/ouroboros/issues/246))
 * executors give each machine its own `CCACHE_DIR` on its own disk, and nothing moves objects
 * between machines. The *number* is honest either way — a weighted hit rate over the day's
 * builds is the same arithmetic whoever the cache belonged to — so the label is the only part
 * that could be wrong, and it is the part that tells an operator whether adding a second
 * runner to a pool will warm anything.
 *
 * It is a named value rather than a literal in the label for one reason: AJ.2
 * ([#264](https://github.com/NobuData/ouroboros/issues/264)) makes sharing real, and when it
 * does this is the one line that changes. `grep CACHE_SHARING` is the whole of that edit.
 */
export type CacheSharing = "per-runner" | "shared-per-pool";

/**
 * What is true today. **`shared-per-pool` is AJ.2's to set**, and nothing in this release may
 * return it — there is no column, no configuration and no code that could make it true, which
 * is exactly why the label must not claim it.
 */
export const CACHE_SHARING: CacheSharing = "per-runner";

/**
 * The cache the agent measures.
 *
 * ccache, because that is the only cache `build_jobs.ccache_stats` describes — V040's
 * `build_ccache_stats_valid` closes the document to `hits`, `misses`, `version`, `size_bytes`
 * and `max_size_bytes`, and AG.5 ([#247](https://github.com/NobuData/ouroboros/issues/247))
 * fills it from `ccache --print-stats`. A second cache would be a second column and a second
 * name here, not a second meaning for this one.
 */
export const CACHE_TOOL = "ccache";

/**
 * The cache card's sub-label, composed.
 *
 * Composed rather than written out, so that the string cannot say `shared per pool` while
 * {@link CACHE_SHARING} says otherwise — the failure the acceptance criterion *the label is
 * derived, not hard-coded* is about. The separator is the mockup's middle dot, which every
 * other sub-label on the page uses.
 *
 * @param sharing - How the caches are shared. Defaults to {@link CACHE_SHARING}; the parameter
 *   exists so a suite can render AJ.2's label without changing what this release returns.
 * @param tool - The cache. Defaults to {@link CACHE_TOOL}.
 * @returns `ccache · per-runner`.
 */
export function cacheLabel(
  sharing: CacheSharing = CACHE_SHARING,
  tool: string = CACHE_TOOL,
): string {
  return `${tool} · ${sharing}`;
}

/** The boundaries one read of the farm page is measured between. */
export interface FarmWindows {
  /** The request instant. Every other field is derived from it. */
  readonly now: Date;
  /** Midnight in {@link FARM_TIME_ZONE} on the day `now` falls in — where *today* starts. */
  readonly dayStart: Date;
  /**
   * Where *last week* starts: seven whole days before {@link FarmWindows.dayStart}.
   *
   * Stepped back from the day boundary rather than from `now`, so the prior window is seven
   * whole days that end exactly where today begins — see this file's header.
   */
  readonly priorStart: Date;
  /** The zone the two calendar boundaries above were taken in. Published in the payload. */
  readonly timeZone: string;
}

/**
 * The windows a read at this instant measures over.
 *
 * @param now - The request instant. Injected rather than read from a clock here, so one read's
 *   statements share one boundary and a suite can state the moment it is asking about —
 *   including 23:58, which is the case the day boundary exists for.
 * @param timeZone - The zone the calendar boundaries are taken in.
 * @returns The windows.
 * @throws {RangeError} If the zone is not one the runtime knows — thrown by `startOfDay`, and
 *   deliberately not caught: a boundary nobody can compute must not silently become UTC's.
 */
export function farmWindows(now: Date, timeZone: string = FARM_TIME_ZONE): FarmWindows {
  const dayStart = startOfDay(now, timeZone);

  return {
    now,
    dayStart,
    priorStart: new Date(dayStart.getTime() - PRIOR_WINDOW_DAYS * DAY_MS),
    timeZone,
  };
}
