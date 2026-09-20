/**
 * One build's log, streamed by offset — the loop under the live log card and the full-log sheet
 * (AI.6, [#261](https://github.com/NobuData/ouroboros/issues/261)).
 *
 * AH.5 ([#253](https://github.com/NobuData/ouroboros/issues/253)) serves a log a page at a time
 * from `?after=`, and promises that successive pages concatenate to exactly the stored log. This
 * is the client's half of that promise. The **timing** — the interval, the hidden tab that polls
 * not at all, the sequence check that drops an overtaken answer — is `app/poll.ts`'s loop,
 * reused rather than copied; what is here is the one thing that loop does not know: that each
 * answer is a *continuation* of the last, to be folded into what is already held rather than to
 * replace it.
 *
 * ### Exact resume
 *
 * The offset moves **only when a page is folded**, and a page is folded only if it starts
 * exactly where the last one ended. Two asks can be in the air over one offset — a refresh
 * supersedes a timer's ask — and the loop applies only the later; a page for any other offset,
 * or for another job, is dropped rather than appended. Nothing is drawn twice and nothing is
 * skipped, by construction rather than by luck with timing.
 *
 * ### Catching up does not wait for the timer
 *
 * A page is at most 256 KiB and the cadence is two seconds, so a reader who waited out the
 * interval between pages would fall behind any build printing faster than that. While a page
 * ends short of the stored log (`nextOffset < end`) the next is asked for at once.
 *
 * ### The card joins a long log at its tail
 *
 * The card holds a bounded window, so paging through twenty minutes of output to reach the line
 * being printed now would draw thousands of rows only to drop them. In `tail` mode, a first page
 * that leaves more than {@link TAIL_BYTES} unread is set aside and the stream **jumps** to the
 * last {@link TAIL_BYTES} — landing on an arbitrary byte, so the rest of the line it lands in is
 * left out (`appendPage`'s `skipping`) and a note says earlier output exists. `full` mode — the
 * sheet behind **Full log ↗** — never jumps.
 *
 * ### `live` is the job's state
 *
 * The flag is passed through exactly as served: it is never inferred from whether a page carried
 * text. A finished log that has been read to its end is **final** (AH.5: chunks are written only
 * while the job is live), so the stream stops asking altogether.
 *
 * **Framework-free**; `app/farm/use-log-stream.ts` is where it meets React.
 */

import type { BuildLog } from "@/app/api/farm";
import { type PollOptions, createPoll } from "@/app/poll";

import {
  EMPTY_LOG_BUFFER,
  type LogBuffer,
  type LogLimits,
  type LogRow,
  appendPage,
  logRows,
} from "./log-buffer";
import { type LogReader, requestLog } from "./log-poll";

/** How a log is read: from its tail, for the card's window, or whole, for the sheet. */
export type LogMode = "tail" | "full";

/** How much of a long log the card joins at — two pages, a few thousand lines. */
export const TAIL_BYTES = 512 * 1024;

/** What each mode holds. The card's window is small; the sheet's is as much as a tab should. */
export const LOG_LIMITS: Readonly<Record<LogMode, LogLimits>> = {
  tail: { maxLines: 5_000, maxColumns: 2_000 },
  full: { maxLines: 100_000, maxColumns: 2_000 },
};

/** What is said above the first row when earlier output is not held, per mode. */
export const EARLIER_OUTPUT: Readonly<Record<LogMode, string>> = {
  tail: "[… earlier output is not shown here — Full log has all of it]",
  full: "[… earlier output is no longer held in view]",
};

/**
 * How recently the build must have been heard running for its end to count as **witnessed**, in
 * milliseconds. Comfortably more than one two-second poll and one slow read; far less than a tab
 * left hidden while the build finished.
 */
export const WITNESS_WINDOW_MS = 12_000;

/** What a pane and a header read. */
export interface LogView {
  /** The rows to draw, top to bottom. Identity-stable until a page changes them. */
  readonly rows: readonly LogRow[];
  /** The widest row seen, in characters. */
  readonly columns: number;
  /**
   * Whether the log can still grow — **the job's state, as served** — or `null` before the first
   * page has answered.
   */
  readonly live: boolean | null;
  /**
   * When the build was heard to have ended, in epoch milliseconds — **only if the end was
   * witnessed**: the build was heard running within {@link WITNESS_WINDOW_MS} before it was
   * heard finished. `null` while it runs, and `null` for an end nobody was watching (a job
   * already finished when first read; a tab hidden for an hour), because the log carries no
   * finish time and *when this tab found out* is not one.
   */
  readonly endedAt: number | null;
  /** `false` once the retention sweep has removed the log; there is then nothing to draw. */
  readonly retained: boolean;
  /** Whether everything stored so far has been read. */
  readonly settled: boolean;
  /** Why the latest ask failed, as a sentence for a person, or `null`. What is held is kept. */
  readonly error: string | null;
}

/** Nothing read yet: what the server renders, and what a pane holds until the first page. */
export const EMPTY_LOG_VIEW: LogView = Object.freeze({
  rows: EMPTY_LOG_BUFFER.lines,
  columns: 0,
  live: null,
  endedAt: null,
  retained: true,
  settled: false,
  error: null,
});

/** How to build a stream. Everything is optional; production supplies none of it. */
export interface LogStreamOptions extends PollOptions {
  /** How to make one read. Defaults to `requestLog`. */
  readonly read?: LogReader;
  /** Tail or whole. Defaults to `tail`. */
  readonly mode?: LogMode;
  /** How much to hold — a test's way to a small window. Defaults to {@link LOG_LIMITS}. */
  readonly limits?: LogLimits;
  /** How much of a long log to join at. Defaults to {@link TAIL_BYTES}. */
  readonly tailBytes?: number;
}

/** The stream, as its consumers see it — `app/poll.ts`'s `Poll`, over an accumulating view. */
export interface LogStream {
  /** @returns The view as it stands; identity-stable until something changes. */
  snapshot(): LogView;
  /**
   * Hear about changes.
   *
   * @param listener Called after each change, with no argument.
   * @returns The way to stop listening.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Begin streaming. Called from an effect, for the reason `Poll.start` gives.
   *
   * @returns The way to stop. Starting again afterwards resumes from the offset reached.
   */
  start(): () => void;
}

/**
 * Whether two tails say the same thing.
 *
 * @param a One page's `tail`.
 * @param b Another's.
 * @returns `true` when a marker drawn from either would read the same.
 */
function sameTail(a: BuildLog["tail"], b: BuildLog["tail"]): boolean {
  if (a === null || b === null) return a === b;

  return a.bytes === b.bytes && a.missingChunks === b.missingChunks && a.capped === b.capped;
}

/**
 * Build a stream over one build's log.
 *
 * @param jobId The build job.
 * @param options Test seams and the mode; production passes only the mode.
 * @returns The stream. It is inert until {@link LogStream.start} is called.
 */
export function createLogStream(jobId: string, options: LogStreamOptions = {}): LogStream {
  const read = options.read ?? requestLog;
  const mode = options.mode ?? "tail";
  const limits = options.limits ?? LOG_LIMITS[mode];
  const tailBytes = options.tailBytes ?? TAIL_BYTES;
  const now = options.now ?? (() => Date.now());

  /** Where the next page must start. Moved only by {@link take}. */
  let offset = 0;
  let buffer: LogBuffer = EMPTY_LOG_BUFFER;
  let tail: BuildLog["tail"] = null;
  /** Whether the stream joined at the tail, and whether it is still inside the line it landed in. */
  let jumped = false;
  let skipping = false;
  /** The note above the first row, as last drawn. */
  let noted: string | null = null;
  /** When the build was last heard running. */
  let liveAt: number | null = null;
  /** The last page looked at, by identity — a failed ask republishes the one before it. */
  let seen: BuildLog | null = null;
  let view: LogView = EMPTY_LOG_VIEW;

  const listeners = new Set<() => void>();
  const poll = createPoll<BuildLog>(() => read(jobId, offset), options);
  let stopPoll: (() => void) | null = null;

  /**
   * Replace the view, if anything in it moved, and tell everyone.
   *
   * @param next The view as it now stands.
   * @returns Nothing.
   */
  function publish(next: LogView): void {
    const keys = Object.keys(next) as (keyof LogView)[];
    if (keys.every((key) => next[key] === view[key])) return;

    view = Object.freeze(next);
    for (const listener of [...listeners]) listener();
  }

  /**
   * Fold one page in.
   *
   * @param page A page that starts where the last one ended.
   * @returns The view after it.
   */
  function take(page: BuildLog): LogView {
    const at = now();
    const before = { buffer, tail, earlier: noted };

    if (mode === "tail" && !jumped && page.offset === 0 && page.end - page.nextOffset > tailBytes) {
      // The log is long and the card's window is short: join at the tail. This page is set
      // aside unread, and the line the jump lands in is left out.
      jumped = true;
      skipping = true;
      offset = page.end - tailBytes;
    } else {
      if (page.bytes !== "" || page.elisions.length > 0) {
        const appended = appendPage(buffer, page, limits, skipping);
        buffer = appended.buffer;
        skipping = appended.skipping;
      }

      offset = page.nextOffset;
    }

    if (!page.retained) buffer = EMPTY_LOG_BUFFER;
    tail = sameTail(tail, page.tail) ? tail : page.tail;

    // A log that is gone has no *earlier*: there is nothing on screen for it to be earlier than.
    const partial = page.retained && (jumped || buffer.dropped > 0);
    const earlier = partial ? EARLIER_OUTPUT[mode] : null;
    const moved = buffer !== before.buffer || tail !== before.tail || earlier !== before.earlier;
    const endedAt = endOf(page, at);

    noted = earlier;
    if (page.live) liveAt = at;

    return {
      rows: moved ? logRows(buffer, { earlier, tail }) : view.rows,
      columns: buffer.columns,
      live: page.live,
      endedAt,
      retained: page.retained,
      settled: offset >= page.end,
      error: null,
    };
  }

  /**
   * When the build ended, as far as this stream can honestly say — see {@link LogView.endedAt}.
   *
   * @param page The page being folded.
   * @param at When it was heard.
   * @returns `null` while the build runs; then the instant of the **first** page that said it
   *   was over, if the build had been heard running shortly before — and never moved afterwards.
   */
  function endOf(page: BuildLog, at: number): number | null {
    if (page.live) return null;
    if (view.live === false) return view.endedAt;

    return liveAt !== null && at - liveAt <= WITNESS_WINDOW_MS ? at : null;
  }

  /** Hear one answer from the loop. @returns Nothing. */
  function onAnswer(): void {
    const answer = poll.snapshot();
    const page = answer.data;

    // A failure republishes the page before it; only a page not yet looked at is folded.
    if (page === null || page === seen || answer.error !== null) {
      publish({ ...view, error: answer.error });
      return;
    }

    seen = page;

    // Exact resume: anything that does not continue the log from where it stands is dropped.
    if (page.jobId !== jobId || page.offset !== offset) return;

    const next = take(page);
    publish(next);

    if (!next.settled) {
      // More is stored than this page reached. After the loop has scheduled its timer, so the
      // ask replaces the wait rather than racing it.
      queueMicrotask(() => poll.refresh());
    } else if (next.live === false) {
      // A finished log, read to its end, is final.
      halt();
    }
  }

  /** Stop asking. @returns Nothing. Safe to call twice. */
  function halt(): void {
    stopPoll?.();
    stopPoll = null;
  }

  return {
    snapshot: () => view,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    start() {
      const unsubscribe = poll.subscribe(onAnswer);
      stopPoll = poll.start();

      return () => {
        halt();
        unsubscribe();
      };
    },
  };
}
