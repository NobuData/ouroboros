/**
 * The stat row's arithmetic — four cards, and the rule that decides every one of them.
 *
 * AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)), mockup 08's
 * `4/5 · 23 · 4m 12s · 78%`.
 *
 * ---------------------------------------------------------------------------
 * **`null` is not `0`, and this file is where the difference is decided.**
 *
 * Two of these cards count things and two of them average things, and the distinction is the
 * whole of what makes an empty organization render honestly:
 *
 *   * **A count of nothing is `0`.** A workspace with no runners has *zero* runners online out
 *     of zero, and a workspace that has built nothing today has built *zero* things. Those are
 *     measurements, and their answer is a number.
 *   * **An average of nothing is `null`.** The mean duration of no builds is not `0m 00s` —
 *     that would read as a farm so fast it finished instantly. A cache hit rate over no cached
 *     objects is not `0%` — that would read as a cache that missed every time. Neither
 *     measurement was taken, and `null` is the only answer that says so. AI.1
 *     ([#256](https://github.com/NobuData/ouroboros/issues/256)) renders it as the mockup's
 *     em-dash; V040's `build_ccache_stats_valid` makes the same argument in the database, for
 *     the same column.
 *   * **A comparison needs both sides.** `deltaVsLastWeek` is `null` when the prior week holds
 *     no builds, because `▼ 0s` on a farm that was switched on this morning claims a
 *     comparison nobody made. It is `0` only when the two windows genuinely averaged the same.
 *
 * Every function below therefore returns `number | null` where an average or a delta is
 * concerned, and `number` where a count is.
 */

import type { Runner } from "../../db/schema";
import { cacheLabel } from "./fleet.policy";
import type {
  AvgBuildTimeStat,
  BuildsTodayStat,
  CacheHitRateStat,
  FarmStatsResource,
  RunnersOnlineStat,
} from "./fleet.resources";

/** Seconds in a minute, an hour and a day — named so {@link lastSeenAge} reads. */
const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;
const DAY_S = 24 * HOUR_S;

/**
 * The statuses that count as *online* on the first card.
 *
 * Everything the fleet can currently vouch for. `draining` is in the list and that is a
 * decision rather than an oversight: a draining machine is connected, is finishing a build and
 * is still costing what a runner costs — mockup 08 counts `bigiron` among its four. `offline`
 * is out because it is the measurement that says the fleet cannot vouch for it, and `removed`
 * is out of *both* sides of the fraction because a retired machine is not in the fleet at all.
 */
const ONLINE_STATUSES = new Set(["online", "building", "draining"]);

/** The counted build outcomes today — V040's four terminal states, in the mockup's order. */
export interface BuildOutcomeCounts {
  /** `succeeded` — the mockup's *19 clean*. */
  readonly succeeded: number;
  /** `retried` — an attempt that failed for infrastructure reasons and was replaced. */
  readonly retried: number;
  /** `failed` — a build that ran and exited non-zero. */
  readonly failed: number;
  /**
   * `canceled` — a build somebody stopped.
   *
   * **Not on the mockup, and counted anyway.** V040 says today's builds are partitioned by
   * the four terminal states, and three counts that do not add up to the total would be a
   * partition with a hole in it. The seeded day has none, so the card still reads
   * `19 clean · 3 retried · 1 failed` — but a workspace that cancels a build gets a total it
   * can account for rather than one that is quietly larger than its parts.
   */
  readonly canceled: number;
}

/** One window's duration aggregate, as the repository measures it. */
export interface DurationAggregate {
  /** How many builds contributed. Zero is what makes the mean `null`. */
  readonly builds: number;
  /** The sum of their durations, in seconds. */
  readonly totalSeconds: number;
}

/** The day's ccache totals, summed across the builds that reported any. */
export interface CacheAggregate {
  /** Σ `hits`. */
  readonly hits: number;
  /** Σ (`hits` + `misses`) — the objects the compiler asked the cache about. */
  readonly objects: number;
}

/**
 * How many runners are up, out of how many there are — and which one went away last.
 *
 * @param runners - The workspace's fleet, **already excluding `removed`**. Excluded by the
 *   statement rather than filtered here, so a removed machine is not merely left out of the
 *   count but is absent from the runners table beside it — one rule, one place.
 * @param now - The request instant, which the note's age is measured back from. Passed rather
 *   than read here, so the note agrees with the rest of the payload.
 * @returns The card. `note` is `null` for a fleet with nothing offline, which includes the
 *   empty fleet: `0/0` with nothing to say about it.
 */
export function runnersOnline(runners: readonly Runner[], now: Date): RunnersOnlineStat {
  const online = runners.filter((runner) => ONLINE_STATUSES.has(runner.status)).length;
  const offline = mostRecentlyOffline(runners);

  return {
    online,
    total: runners.length,
    note: offline ? `${offline.name} offline · ${lastSeenAge(offline, now)}` : null,
    offline: offline
      ? { name: offline.name, lastSeenAt: offline.last_seen_at?.toISOString() ?? null }
      : null,
  };
}

/**
 * The offline runner that was seen most recently — the one the note names.
 *
 * **Most recent, not oldest**, because the note answers *what just happened to the fleet*.
 * A farm with a machine that died two hours ago and one that was decommissioned in spirit six
 * months ago has news about the first; the second is a fact somebody already knows.
 *
 * A runner that has **never** connected sorts last whatever its enrollment date, because
 * `last_seen_at` is null and there is no instant to compare: it has not been seen, so it
 * cannot have been seen recently.
 *
 * @param runners - The fleet.
 * @returns The runner, or `undefined` when none is offline.
 */
function mostRecentlyOffline(runners: readonly Runner[]): Runner | undefined {
  return runners
    .filter((runner) => runner.status === "offline")
    .reduce<Runner | undefined>((latest, runner) => {
      if (!latest) return runner;
      if (!runner.last_seen_at) return latest;
      if (!latest.last_seen_at) return runner;

      return runner.last_seen_at > latest.last_seen_at ? runner : latest;
    }, undefined);
}

/**
 * How long ago a runner was last seen, as the note spells it.
 *
 * One unit, the largest that fits, floored — mockup 08's `2h`. Floored rather than rounded
 * because *last seen 2h ago* about a machine last seen 1h 50m ago is a claim the fleet cannot
 * support; erring towards *less time has passed* would be the direction that flatters.
 *
 * @param runner - The offline runner, and the instant it was last seen at.
 * @param now - The instant to measure from. The request's, so the note agrees with the rest of
 *   the payload rather than with the moment this function happened to be called.
 * @returns `45s`, `12m`, `2h`, `3d` — or `never seen`, for a machine that enrolled and never
 *   connected. Enrollment is not a sighting, and *0h* would say it was here just now.
 */
function lastSeenAge(runner: Runner, now: Date): string {
  if (!runner.last_seen_at) return "never seen";

  const seconds = Math.max(0, Math.floor((now.getTime() - runner.last_seen_at.getTime()) / 1000));
  if (seconds < MINUTE_S) return `${seconds}s`;
  if (seconds < HOUR_S) return `${Math.floor(seconds / MINUTE_S)}m`;
  if (seconds < DAY_S) return `${Math.floor(seconds / HOUR_S)}h`;

  return `${Math.floor(seconds / DAY_S)}d`;
}

/**
 * The counted half of the *Builds today* card — everything but the window it was counted over.
 *
 * Separate from {@link BuildsTodayStat} because the two halves come from different places:
 * the counts are the database's and the boundaries are `fleet.policy.ts`'s, and
 * {@link farmStats} is the one function that has both.
 */
export type BuildCounts = Omit<BuildsTodayStat, "since" | "timeZone">;

/**
 * Today's builds, and the partition the sub-label prints.
 *
 * @param counts - The four terminal states, counted over the day window.
 * @returns The counts. `total` is their sum rather than a fifth query, which is what makes
 *   the three numbers on the mockup add up by construction instead of by coincidence.
 */
export function buildsToday(counts: BuildOutcomeCounts): BuildCounts {
  return {
    total: counts.succeeded + counts.retried + counts.failed + counts.canceled,
    clean: counts.succeeded,
    retried: counts.retried,
    failed: counts.failed,
    canceled: counts.canceled,
  };
}

/**
 * The mean build time today, and how it compares with the week before.
 *
 * @param today - Today's durations.
 * @param prior - The prior seven whole days'.
 * @returns The card. `seconds` is `null` when nothing finished today; `deltaVsLastWeek` is
 *   `null` when **either** window is empty — a delta needs two means, and one of them being
 *   absent is not the same as the two being equal.
 */
export function avgBuildTime(today: DurationAggregate, prior: DurationAggregate): AvgBuildTimeStat {
  const seconds = mean(today);
  const priorSeconds = mean(prior);

  return {
    seconds,
    builds: today.builds,
    priorSeconds,
    priorBuilds: prior.builds,
    deltaVsLastWeek: seconds !== null && priorSeconds !== null ? seconds - priorSeconds : null,
  };
}

/**
 * A window's mean duration, to the second.
 *
 * @param window - Its builds and their total duration.
 * @returns The mean, or `null` over no builds — see this file's header.
 */
function mean(window: DurationAggregate): number | null {
  return window.builds === 0 ? null : Math.round(window.totalSeconds / window.builds);
}

/**
 * The day's cache hit rate, weighted by objects, and the label that says what it is a rate of.
 *
 * **Weighted, not a mean of per-build rates.** Σ hits ÷ Σ objects is the fleet's actual hit
 * rate; averaging each build's own percentage would give a twelve-object build the same say as
 * a five-hundred-object one. It is also what makes a build carrying *no* summary cost nothing:
 * it contributes to neither sum, where a mean of rates would have to either drop it or read it
 * as 0% — and reading *not measured* as *missed every time* is what decision **B5** exists to
 * prevent.
 *
 * @param cache - The day's totals, summed over the builds that reported any.
 * @returns The card. `pct` is `null` when no build today reported a cache — which is a farm
 *   whose builds are not cached, not a farm whose cache never hits.
 */
export function cacheHitRate(cache: CacheAggregate): CacheHitRateStat {
  return {
    pct: cache.objects === 0 ? null : Math.round((cache.hits / cache.objects) * 100),
    hits: cache.hits,
    objects: cache.objects,
    label: cacheLabel(),
  };
}

/** Everything the four cards are computed from, for one read. */
export interface StatInputs {
  /** The fleet, excluding `removed`. */
  readonly runners: readonly Runner[];
  /** Today's terminal builds, by outcome. */
  readonly outcomes: BuildOutcomeCounts;
  /** Today's durations. */
  readonly today: DurationAggregate;
  /** The prior seven whole days'. */
  readonly prior: DurationAggregate;
  /** Today's ccache totals. */
  readonly cache: CacheAggregate;
  /** Where today starts, ISO 8601 — published so a client can say which day is meant. */
  readonly since: string;
  /** The zone that boundary was taken in. */
  readonly timeZone: string;
  /** The request instant every age on this payload is measured back from. */
  readonly now: Date;
}

/**
 * The whole stat row.
 *
 * @param inputs - The aggregates, all measured over one set of boundaries.
 * @returns The four cards.
 */
export function farmStats(inputs: StatInputs): FarmStatsResource {
  return {
    runnersOnline: runnersOnline(inputs.runners, inputs.now),
    buildsToday: {
      ...buildsToday(inputs.outcomes),
      since: inputs.since,
      timeZone: inputs.timeZone,
    },
    avgBuildTime: avgBuildTime(inputs.today, inputs.prior),
    cacheHitRate: cacheHitRate(inputs.cache),
  };
}
