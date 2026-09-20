/**
 * Every decision the build farm's head and stat row make, and every sentence they say
 * (AI.1, [#256](https://github.com/NobuData/ouroboros/issues/256)).
 *
 * Mockup 08's frame is a head whose title is three live values in a sentence, three actions and
 * a row of four stat tiles. What those draw is a handful of judgements — how the sentence reads
 * when a value is zero or absent, which way round good news is coloured, when a comparison is
 * claimed at all — and each lives here so its acceptance criterion is a unit test on a small
 * value rather than an assertion about markup.
 *
 * **Framework-free and pure**, the way `app/planning/view.ts` is: nothing here imports React,
 * `next/*` or the server-only client. The read is `app/farm/data.ts`'s, the refresh is
 * `app/farm/farm-store.tsx`'s and the drawing is `app/farm/farm-head.tsx`'s and
 * `app/farm/farm-stat-row.tsx`'s.
 *
 * ### `null` is not `0`, all the way to the glass
 *
 * AH.6's payload ([#254](https://github.com/NobuData/ouroboros/issues/254)) keeps two kinds of
 * nothing apart, and so does everything below: a **count** of nothing is a genuine zero (`0/0`
 * runners, `0` builds), and an **average** of nothing is `null` — drawn as {@link NOT_MEASURED},
 * never `0m 00s` and never `0%`, because a farm with no builds is not a fast farm and a cache
 * nobody measured is not a cache that missed.
 */

import type { FarmPage, FarmStats } from "@/app/api/farm";
import { elapsedOfSeconds } from "@/app/format";
import type { StatTone } from "@/app/ui/stat-card";

/* ------------------------------------------------------------------ the head */

/** The eyebrow over the heading, verbatim from the mockup. */
export const FARM_EYEBROW = "Build Farm";

/** The subline under the heading, verbatim from the mockup. */
export const FARM_SUBLINE =
  "The Ouroboros server dispatches builds to your own machines over an outbound-only agent " +
  "connection — your hardware, your network, no inbound ports.";

/**
 * The heading of a page that could not be read at all.
 *
 * The same three-beat sentence with nothing claimed in it: a headline is three live values, and
 * with no payload there are none. It does not say *could not be read* — that is the banner's,
 * once, with the reason and the retry (`app/farm/farm-banner.tsx`).
 */
export const FARM_HEADLINE_UNREAD = "Runners. Pools. Cache hits.";

/** The headline's first sentence over an empty fleet. */
export const NO_RUNNERS = "No runners yet.";

/** Its second, over a workspace with no pools. */
export const NO_POOLS = "No pools yet.";

/**
 * Its third, when no build today reported a cache.
 *
 * *Today*, because that is the window the rate is taken over — and *no data* rather than `0%`,
 * which is decision **B5**: a missing summary means *not measured*, and a headline reading
 * `0% cache hits` would be the product claiming a miss rate it never observed.
 */
export const NO_CACHE_DATA = "No cache data today.";

/**
 * One counted sentence of the headline — `5 runners.`, `1 pool.`
 *
 * @param count How many.
 * @param singular The noun for one.
 * @param none What to say instead when there are none — a bare `0 runners.` is a number where
 *   a person would have written a sentence.
 * @returns The sentence, with its full stop.
 */
function counted(count: number, singular: string, none: string): string {
  if (count <= 0) return none;

  return `${count} ${singular}${count === 1 ? "" : "s"}.`;
}

/**
 * The page heading — mockup 08's `5 runners. 2 pools. 78% cache hits.`
 *
 * **Not a title: three live values in a sentence**, which therefore has to degrade clause by
 * clause. A brand-new organization reads *No runners yet. No pools yet. No cache data today.*,
 * a fleet of one reads `1 runner.` rather than `1 runners.`, and each clause degrades on its own
 * — a farm with runners and pools whose builds report no cache still counts them.
 *
 * The runner count is `stats.runnersOnline.total` — the fleet excluding retired machines, the
 * same denominator the first tile draws — so the heading and the `4/5` under it cannot disagree.
 * The cache clause is a percentage and nothing more, which is honest under B5 either way: what
 * could lie is the *label* saying whose cache it is, and that is the tile's
 * ({@link cacheStat}).
 *
 * @param page The page, or `null` when nothing has been read.
 * @returns The heading.
 */
export function farmHeadline(page: FarmPage | null): string {
  if (page === null) return FARM_HEADLINE_UNREAD;

  const { pct } = page.stats.cacheHitRate;

  return [
    counted(page.stats.runnersOnline.total, "runner", NO_RUNNERS),
    counted(page.pools.length, "pool", NO_POOLS),
    pct === null ? NO_CACHE_DATA : `${pct}% cache hits.`,
  ].join(" ");
}

/* ------------------------------------------------------------------ the head's actions */

/** The mark an unbuilt control carries in its text, as the sidebar's *soon* rows do. */
export const SOON_MARK = "soon";

/** One action in the page head. None of the three can act yet — see {@link FARM_ACTIONS}. */
export interface FarmAction {
  /** Stable identifier, and the React key. */
  readonly id: string;
  /** The control's label, verbatim from the mockup. */
  readonly label: string;
  /** Which button tone — the mockup's two ghosts and one primary. */
  readonly tone: "ghost" | "primary";
  /** Why it cannot act, naming the issue that builds what it opens. The control's tooltip. */
  readonly soonNote: string;
}

/**
 * The mockup's three head actions, each an honest *soon*.
 *
 * - **✦ Build Analyzer** is mockup 18, whose route is BW.1
 *   ([#516](https://github.com/NobuData/ouroboros/issues/516)). The mockup links it to a page
 *   that does not exist; here it is inert and says so, rather than a link into a 404. The
 *   amendment on #256 records the other half: on the commit that builds `/analyzer`, this entry
 *   becomes a link to it and the soon-state copy is retired.
 * - **Pool settings** opens AI.4's sheet ([#259](https://github.com/NobuData/ouroboros/issues/259)).
 * - **+ Enroll runner** starts AI.3's flow ([#258](https://github.com/NobuData/ouroboros/issues/258)).
 *
 * Both of those depend on this issue, so neither exists yet. The design system's honesty rule
 * (§ 3.5) is that a surface that is not ready is *labelled*, never dead: each control keeps its
 * place and its label, is inert, and its tooltip names the issue it waits for. No role is
 * decided here for the same reason — a control that cannot act for anybody has no *for whom*;
 * the admin gate arrives with the flows it guards.
 */
export const FARM_ACTIONS: readonly FarmAction[] = [
  {
    id: "analyzer",
    label: "✦ Build Analyzer",
    tone: "ghost",
    soonNote: "The Build Analyzer arrives with #516.",
  },
  {
    id: "pools",
    label: "Pool settings",
    tone: "ghost",
    soonNote: "Pool settings arrive with the pools card (#259).",
  },
  {
    id: "enroll",
    label: "+ Enroll runner",
    tone: "primary",
    soonNote: "Enrolling a runner arrives with the enroll card (#258).",
  },
];

/* ------------------------------------------------------------------ the stat row */

/** What is drawn in place of an average nobody could take — the contract's em-dash. */
export const NOT_MEASURED = "—";

/** What stands under a figure that could not be read. The *why* is the banner's, once. */
export const NOT_READ = "Could not be read.";

/** One tile of the stat row, as `app/ui/stat-card.tsx` draws it. */
export interface FarmStat {
  /** Stable identifier, and the React key. */
  readonly id: "runners" | "builds" | "time" | "cache";
  /** The caption above the figure. */
  readonly label: string;
  /** The figure, already formatted — {@link NOT_MEASURED} when there is none. */
  readonly value: string;
  /** The quieter rest of the figure — the `/5` of `4/5` — or `null`. */
  readonly valueSuffix: string | null;
  /** Whether the figure takes the accent: the one tile in the present tense. */
  readonly accent: boolean;
  /** The line under the figure, or `null` when there is nothing it can honestly say. */
  readonly delta: string | null;
  /** How that line is drawn. */
  readonly tone: StatTone;
  /**
   * How full the tile's meter is, `0`–`1`, or `null` for a tile with no meter — which is every
   * tile but the cache's, and the cache's too when nothing was measured: an empty bar would be
   * a picture of `0%`.
   */
  readonly meter: number | null;
}

/** What the runners tile says over a fleet with nothing offline. */
export const ALL_CONNECTED = "Every runner is connected.";

/** What it says over an empty fleet. */
export const NO_RUNNERS_ENROLLED = "No runners enrolled yet.";

/**
 * *Runners online* — `4/5`, and the machine that most recently went away.
 *
 * The figure is accented because it is the one tile in the present tense, and the `/5` is the
 * quiet half of it. `0/0` is a genuine count for a workspace that has enrolled nothing.
 *
 * **The line is the service's own note**, `forge-03 offline · 2h`. The payload also carries the
 * instant it was computed from, so a page left open could re-age it — but this page polls on the
 * fleet's ten-second heartbeat, and every answer brings the note re-aged by the one clock that
 * also decided *offline*. Re-deriving it here would be a second opinion about the same fact.
 *
 * @param runners The payload's `stats.runnersOnline`.
 * @returns The tile.
 */
export function runnersStat(runners: FarmStats["runnersOnline"]): FarmStat {
  return {
    id: "runners",
    label: "Runners online",
    value: String(runners.online),
    valueSuffix: `/${runners.total}`,
    accent: true,
    delta: runners.note ?? (runners.total === 0 ? NO_RUNNERS_ENROLLED : ALL_CONNECTED),
    tone: "muted",
    meter: null,
  };
}

/** What the builds tile says before anything has finished today. */
export const NO_BUILDS_TODAY = "No builds yet today.";

/**
 * *Builds today* — `23`, and `19 clean · 3 retried · 1 failed` under it.
 *
 * The split is the card's subject, so its three parts are always printed once there is a build
 * to split — `5 clean · 0 retried · 0 failed` is a good day said out loud, not noise. A
 * cancelled build is not on the mockup and is counted anyway (`total` is all four summed), so it
 * joins the line **only when there is one**: the seeded day reads exactly as the mockup does,
 * and a day somebody stopped a build on still adds up.
 *
 * @param builds The payload's `stats.buildsToday`.
 * @returns The tile.
 */
export function buildsStat(builds: FarmStats["buildsToday"]): FarmStat {
  const parts = [`${builds.clean} clean`, `${builds.retried} retried`, `${builds.failed} failed`];
  if (builds.canceled > 0) parts.push(`${builds.canceled} canceled`);

  return {
    id: "builds",
    label: "Builds today",
    value: String(builds.total),
    valueSuffix: null,
    accent: false,
    delta: builds.total === 0 ? NO_BUILDS_TODAY : parts.join(" · "),
    tone: "muted",
    meter: null,
  };
}

/** The glyph on a mean that fell. */
const DOWN_ARROW = "▼";

/** The glyph on one that rose. */
const UP_ARROW = "▲";

/** What the comparison is against. */
const VS_LAST_WEEK = "vs last week";

/** What the tile says when today's mean and the prior week's came out the same. */
export const LEVEL_WITH_LAST_WEEK = "Level with last week";

/** Seconds in a minute. */
const SECONDS_PER_MINUTE = 60;

/**
 * A difference between two build times — `38s`, `1m 05s`.
 *
 * Bare seconds under a minute, because the mockup's `▼ 38s` is how a person says it and
 * `0m 38s` is how a clock does; `elapsedOfSeconds` from there up.
 *
 * @param seconds The size of the difference, non-negative.
 * @returns The span.
 */
function deltaSpan(seconds: number): string {
  return seconds < SECONDS_PER_MINUTE ? `${seconds}s` : elapsedOfSeconds(seconds);
}

/**
 * The line under the average: which way it moved against last week, and whether that is good.
 *
 * **Down is good here.** `▼ 38s vs last week` is a farm that got faster, so a falling mean takes
 * the tile's `up` tone — which names *goodness*, not direction (`app/ui/stat-card.tsx`) — and a
 * rising one takes `down`. The arrow carries the direction for a reader who cannot separate the
 * two hues.
 *
 * **Absent, not `▼ 0s`, when no comparison was made.** `deltaVsLastWeek` is `null` when either
 * window is empty — a farm switched on this morning has no last week — and a line claiming
 * `▼ 0s` would claim a comparison nobody made. A real comparison that came out level says so in
 * words and takes no direction at all.
 *
 * @param delta Today's mean less the prior week's, in whole seconds, or `null`.
 * @returns The line and its tone — a `null` line when there is nothing to compare.
 */
export function buildTimeDelta(delta: number | null): Pick<FarmStat, "delta" | "tone"> {
  if (delta === null || !Number.isFinite(delta)) return { delta: null, tone: "muted" };

  const size = Math.round(Math.abs(delta));
  if (size === 0) return { delta: LEVEL_WITH_LAST_WEEK, tone: "muted" };

  return delta < 0
    ? { delta: `${DOWN_ARROW} ${deltaSpan(size)} ${VS_LAST_WEEK}`, tone: "up" }
    : { delta: `${UP_ARROW} ${deltaSpan(size)} ${VS_LAST_WEEK}`, tone: "down" };
}

/**
 * *Avg build time* — `4m 12s`, against the seven whole days before today.
 *
 * {@link NOT_MEASURED} over no builds: an average of nothing is not `0m 00s`.
 *
 * @param time The payload's `stats.avgBuildTime`.
 * @returns The tile.
 */
export function buildTimeStat(time: FarmStats["avgBuildTime"]): FarmStat {
  return {
    id: "time",
    label: "Avg build time",
    value: time.seconds === null ? NOT_MEASURED : elapsedOfSeconds(time.seconds),
    valueSuffix: null,
    accent: false,
    // A delta without a mean above it would be a comparison of nothing: the contract never sends
    // one, and this does not draw one if something else does.
    ...buildTimeDelta(time.seconds === null ? null : time.deltaVsLastWeek),
    meter: null,
  };
}

/** A whole, as a percentage. */
const PERCENT = 100;

/**
 * *Cache hit rate* — `78%`, the meter, and whose cache it is.
 *
 * **The label is the payload's, never written here.** Mockup 08 reads `ccache · shared per
 * pool`; decision **B5** makes the MVP's caches one per runner, so the service composes
 * `ccache · per-runner` and will compose the mockup's words on the commit that makes them true
 * (AJ.2, [#264](https://github.com/NobuData/ouroboros/issues/264)). The percentage is honest
 * either way — the label is the part that could lie, so it has exactly one author.
 *
 * {@link NOT_MEASURED} and no meter when no build today reported a cache: `0%` with an empty bar
 * would be a cache that missed every time, which is a different farm.
 *
 * @param cache The payload's `stats.cacheHitRate`.
 * @returns The tile.
 */
export function cacheStat(cache: FarmStats["cacheHitRate"]): FarmStat {
  return {
    id: "cache",
    label: "Cache hit rate",
    value: cache.pct === null ? NOT_MEASURED : `${cache.pct}%`,
    valueSuffix: null,
    accent: false,
    delta: cache.label,
    tone: "muted",
    meter: cache.pct === null ? null : cache.pct / PERCENT,
  };
}

/**
 * The row's four identities, for the render where no figure could be read.
 *
 * The captions come from here rather than from the payload, so a page whose read was refused
 * keeps its shape — four named tiles holding em dashes, which is a page reporting a failure
 * rather than a page that lost its stat row.
 */
const UNREAD_ROW: readonly (readonly [id: FarmStat["id"], label: string])[] = [
  ["runners", "Runners online"],
  ["builds", "Builds today"],
  ["time", "Avg build time"],
  ["cache", "Cache hit rate"],
];

/**
 * The stat row.
 *
 * @param page The page, or `null` when nothing has been read.
 * @returns The four tiles, in the mockup's order — real figures, or four em dashes that say
 *   *what* could not be read and leave the *why* to the banner. A tile that could not be read
 *   never takes the accent, which is reserved for a figure that is reporting something.
 */
export function farmStatRow(page: FarmPage | null): readonly FarmStat[] {
  if (page === null) {
    return UNREAD_ROW.map(([id, label]) => ({
      id,
      label,
      value: NOT_MEASURED,
      valueSuffix: null,
      accent: false,
      delta: NOT_READ,
      tone: "failed",
      meter: null,
    }));
  }

  const { stats } = page;

  return [
    runnersStat(stats.runnersOnline),
    buildsStat(stats.buildsToday),
    buildTimeStat(stats.avgBuildTime),
    cacheStat(stats.cacheHitRate),
  ];
}

/* ------------------------------------------------------------------ the banner */

/** What the banner is headed with when nothing has ever been read, so nothing can be stale. */
export const FARM_UNREAD_HEADLINE = "The build farm could not be read.";

/**
 * What the banner is headed with.
 *
 * Two states, and the difference is the whole point (`app/dashboard/stale-banner.tsx`): with a
 * page on screen the reader is told *how old it is* and keeps it; with none they are told it
 * could not be read.
 *
 * @param dataAt When the page on screen was last confirmed current, in epoch milliseconds, or
 *   `null` when there is no page.
 * @param clock How to say a time of day. A parameter so the sentence is a pure function of its
 *   inputs — the caller passes the reader's own locale's clock.
 * @returns The headline.
 */
export function farmBannerHeadline(dataAt: number | null, clock: (atMs: number) => string): string {
  return dataAt === null
    ? FARM_UNREAD_HEADLINE
    : `Showing data from ${clock(dataAt)} — the latest refresh failed.`;
}
