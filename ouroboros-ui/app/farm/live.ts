/**
 * Every decision the live log card makes, and every sentence it says
 * (AI.6, [#261](https://github.com/NobuData/ouroboros/issues/261)).
 *
 * Mockup 08's `c-12` card is a header — `LIVE — forge-01 · #479 Add OTA rollback on failed
 * checksum`, a pill, an elapsed time, **Full log ↗** — over a pane of output. The pane's rows are
 * `app/farm/log-buffer.ts`'s and its scrolling is `app/farm/log-pane.tsx`'s; what is here is the
 * rest: **which build the card is about**, and what its header may honestly claim.
 *
 * ### Which build
 *
 * The issue binds the card to *the most recent running job, or a job selected from the table*,
 * and asks that a finished build swap its pill and freeze its cursor — which a card that let go
 * of a build the moment it ended could never show. So ({@link bindJob}):
 *
 * 1. **The reader's selection wins.** A selected runner that is building puts its build on the
 *    card; a selected runner that is not leaves the card where it was.
 * 2. **Otherwise the newest running build** — `live` on the farm's page — takes the card, *if it
 *    started after the build the card holds*.
 * 3. **Otherwise the card holds what it has**, finished or not. A build that ends stays on the
 *    card, truthfully finished, until a newer one starts or the reader selects another.
 * 4. With nothing held and nothing running, the card is empty and says so.
 *
 * ### What the header claims
 *
 * The log's page (`app/api/farm.ts`'s `BuildLog`) says whether the job is over and nothing about
 * how it went or when, so the pill swaps `building` for a neutral **finished** — not a verdict
 * this page cannot read — and the elapsed time stops **only at an end the card witnessed**
 * (`LogView.endedAt`). An end it did not witness draws {@link NOT_MEASURED}: a build that
 * finished while the tab was hidden did not run until the tab came back.
 *
 * **Framework-free and pure**, the way `app/farm/view.ts` is.
 */

import type { FarmPage } from "@/app/api/farm";
import { elapsedOfSeconds } from "@/app/format";
import type { ChipDot, ChipTone } from "@/app/ui/chip";

import { type JobFact, JOB_SHEET_EYEBROW, jobNumber } from "./runners";
import { NOT_MEASURED } from "./view";

/* ------------------------------------------------------------------ which build */

/** A build, as the card needs it — from the page's `live`, or from a runner's current job. */
export interface LiveJob {
  /** The build job's id — what its log is read by. */
  readonly id: string;
  /** `#479`. */
  readonly number: string;
  /** The one-line description the header prints. */
  readonly title: string;
  /** The runner holding it, by name, or `null` when the page named none. */
  readonly runner: string | null;
  /** When it started, or `null` when the page carried no start. */
  readonly startedAt: string | null;
}

/**
 * The newest running build, as the page reports it.
 *
 * @param page The farm's page, or `null` when it could not be read.
 * @returns The build, or `null` when nothing is running.
 */
export function newestJob(page: FarmPage | null): LiveJob | null {
  const live = page?.live ?? null;
  if (live === null) return null;

  return {
    id: live.id,
    number: jobNumber(live.number),
    title: live.title,
    runner: live.runner,
    startedAt: live.startedAt,
  };
}

/**
 * The build a selected runner is working on.
 *
 * @param page The farm's page.
 * @param runnerId The runner the reader selected in the table, or `null`.
 * @returns Its current build, or `null` — nothing selected, a runner that has left the fleet, or
 *   one that is building nothing.
 */
export function selectedJob(page: FarmPage | null, runnerId: string | null): LiveJob | null {
  if (page === null || runnerId === null) return null;

  const runner = page.runners.find((candidate) => candidate.id === runnerId);
  const job = runner?.currentJob ?? null;
  if (runner === undefined || job === null) return null;

  return {
    id: job.id,
    number: jobNumber(job.number),
    title: job.title,
    runner: runner.name,
    startedAt: job.startedAt,
  };
}

/**
 * When a build started, for ordering. A build with no readable start sorts as the oldest, so it
 * never keeps a build with a real one off the card.
 *
 * @param job The build.
 * @returns Epoch milliseconds, or `-Infinity`.
 */
function startedMs(job: LiveJob): number {
  const at = job.startedAt === null ? Number.NaN : Date.parse(job.startedAt);

  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
}

/**
 * Which build the card is about — the module note's four rules.
 *
 * @param held The build the card was about on the last render, or `null`.
 * @param newest The page's newest running build, or `null`.
 * @param selected The reader's selected runner's build, or `null`.
 * @returns The build for this render. **`held` itself when nothing about it changed**, so a
 *   caller comparing by identity sees no change where there was none.
 */
export function bindJob(
  held: LiveJob | null,
  newest: LiveJob | null,
  selected: LiveJob | null,
): LiveJob | null {
  const next = selected ?? preferred(held, newest);

  return next !== null && held !== null && sameJob(next, held) ? held : next;
}

/**
 * The card's own choice between what it holds and what the page says is newest.
 *
 * @param held The build held, or `null`.
 * @param newest The newest running build, or `null`.
 * @returns `newest` when it is the held build seen again or a later one; `held` otherwise.
 */
function preferred(held: LiveJob | null, newest: LiveJob | null): LiveJob | null {
  if (held === null || newest === null) return newest ?? held;
  if (newest.id === held.id) return newest;

  return startedMs(newest) > startedMs(held) ? newest : held;
}

/**
 * Whether two readings of a build would draw the same header.
 *
 * @param a One reading.
 * @param b Another.
 * @returns `true` when every field matches.
 */
function sameJob(a: LiveJob, b: LiveJob): boolean {
  return (
    a.id === b.id &&
    a.number === b.number &&
    a.title === b.title &&
    a.runner === b.runner &&
    a.startedAt === b.startedAt
  );
}

/* ------------------------------------------------------------------ the header */

/** The card's name — the mockup's `LIVE`, and all of the title while nothing is bound. */
export const LIVE_TITLE = "LIVE";

/**
 * The card's title — the mockup's `LIVE — forge-01 · #479 Add OTA rollback on failed checksum`.
 *
 * @param job The build the card is about, or `null`.
 * @returns The title. A build the page named no runner for leaves the runner out rather than
 *   printing a dash in the middle of a sentence.
 */
export function liveTitle(job: LiveJob | null): string {
  if (job === null) return LIVE_TITLE;

  const subject = `${job.number} ${job.title}`;

  return `${LIVE_TITLE} — ${job.runner === null ? subject : `${job.runner} · ${subject}`}`;
}

/** The empty state, in the issue's words. */
export const NO_BUILDS_RUNNING = "No builds running — submit one or wait for the loop.";

/** What the card says when the farm's page itself could not be read. */
export const LIVE_UNREAD = "The live build could not be read.";

/** The header's way to the whole log. */
export const FULL_LOG = "Full log ↗";

/** How a state is drawn — `app/farm/runners.ts`'s `RunnerPill`, for a build. */
export interface LivePill {
  /** The word in the pill. */
  readonly label: string;
  /** Which hue. */
  readonly tone: ChipTone;
  /** Which dot. */
  readonly dot: ChipDot;
}

/** A build that is running — the runners table's own `building` pill. */
const BUILDING: LivePill = { label: "building", tone: "accent", dot: "pulse" };

/** A build that is over. Neutral: the log says *that* it ended, not how. */
const FINISHED: LivePill = { label: "finished", tone: "neutral", dot: "filled" };

/**
 * The header's pill.
 *
 * @param live The log's `live` flag, or `null` before its first page.
 * @returns `building` until the log says otherwise — the card is only ever bound to a build the
 *   page reported as running — and `finished` from the moment it does.
 */
export function livePill(live: boolean | null): LivePill {
  return live === false ? FINISHED : BUILDING;
}

/** Milliseconds in a second. */
const SECOND_MS = 1000;

/**
 * The header's elapsed time — the mockup's `3m 41s`.
 *
 * @param job The build.
 * @param live The log's `live` flag, or `null` before its first page.
 * @param endedAt When the end was witnessed (`LogView.endedAt`), or `null`.
 * @param nowMs The reader's clock.
 * @returns The running time while the build runs; the time it ran for, frozen, once it has ended
 *   in view; {@link NOT_MEASURED} for a build with no start, or an end nobody witnessed.
 */
export function liveElapsed(
  job: LiveJob,
  live: boolean | null,
  endedAt: number | null,
  nowMs: number,
): string {
  const started = startedMs(job);
  const until = live === false ? endedAt : nowMs;

  if (!Number.isFinite(started) || until === null) return NOT_MEASURED;

  return elapsedOfSeconds((until - started) / SECOND_MS);
}

/* ------------------------------------------------------------------ the pane */

/** The pane's accessible name. */
export const LOG_LABEL = "Build log";

/** What an empty pane says for a build that has printed nothing yet. */
export const LOG_WAITING = "";

/** What an empty pane says for a build that ended having printed nothing. */
export const LOG_EMPTY = "This build printed nothing.";

/** What the pane says for a log the retention sweep has removed. */
export const LOG_SWEPT = "This build's log is no longer kept — retention has removed it.";

/**
 * What a pane with no rows says.
 *
 * @param live The log's `live` flag, or `null` before its first page.
 * @param retained Whether the log is still kept.
 * @returns The sentence — empty while output may still arrive, so the pane is a cursor and
 *   nothing else.
 */
export function emptyLogNote(live: boolean | null, retained: boolean): string {
  if (!retained) return LOG_SWEPT;

  return live === false ? LOG_EMPTY : LOG_WAITING;
}

/* ------------------------------------------------------------------ the full-log sheet */

/**
 * Why **Full log ↗** opens a sheet rather than a page — `JOB_SHEET_NOTE`'s argument, for the
 * log: its honest destination is mockup 10's run console (#309), linked from a build by AJ.3
 * (#265), and neither exists yet.
 */
export const LOG_SHEET_NOTE =
  "The run console arrives with #309 — until then this is the build's whole log, from its " +
  "first byte.";

/**
 * The sheet's name — its eyebrow, and what the dialog answers to.
 *
 * @param job The build whose log is open.
 * @returns `Build job #479 — full log`.
 */
export function logSheetLabel(job: LiveJob): string {
  return `${JOB_SHEET_EYEBROW} ${job.number} — full log`;
}

/**
 * What the sheet lists about the build above its log.
 *
 * @param job The build.
 * @param live The log's `live` flag, or `null` before its first page.
 * @param clock How to say an instant — the reader's own locale's clock.
 * @returns The facts, in reading order.
 */
export function logSheetFacts(
  job: LiveJob,
  live: boolean | null,
  clock: (atMs: number) => string,
): readonly JobFact[] {
  const started = startedMs(job);

  return [
    { term: "Job", value: job.number },
    { term: "Runner", value: job.runner ?? NOT_MEASURED },
    { term: "State", value: livePill(live).label },
    { term: "Started", value: Number.isFinite(started) ? clock(started) : NOT_MEASURED },
  ];
}
