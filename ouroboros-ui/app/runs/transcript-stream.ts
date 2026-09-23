/**
 * The transcript's stream — every page of the tail, folded into what the card draws
 * ([#312](https://github.com/NobuData/ouroboros/issues/312)).
 *
 * `app/farm/log-stream.ts` is the same store for a build's log, and the rules are its:
 *
 * - **Exact resume.** The store holds a cursor — the last `seq` it has — and asks for what came
 *   after. A page that does not continue from the cursor is dropped, so a slow answer overtaken
 *   by a newer one can never duplicate or skip an entry.
 * - **Ask again at once while `hasMore`.** More is already stored; waiting out the cadence would
 *   make a long transcript arrive a page per interval.
 * - **Bounded.** Entries are appended, never re-read, and at most `maxEntries` are held — the
 *   oldest leave first, and `dropped` counts them so the card can say so. A transcript is
 *   unbounded in principle; the DOM is not allowed to be. Raw JSONL has every entry.
 * - **A finished transcript is final.** Once a page says the run is no longer live and nothing
 *   more is stored, the loop stops.
 *
 * Framework-free, so every rule is a unit test without rendering; the card meets it through
 * `use-transcript.ts`.
 */

import type { RunEventEntry, RunEventsPage } from "@/app/api/runs";
import { type PollOptions, createPoll } from "@/app/poll";

import { type TranscriptReader, requestEvents } from "./transcript-poll";

/** The most entries the card holds, and therefore draws. */
export const MAX_HELD_ENTRIES = 500;

/** What the card draws from the stream. */
export interface TranscriptView {
  /** The held entries, oldest first. */
  readonly entries: readonly RunEventEntry[];
  /** How many older entries were let go to keep {@link entries} bounded. */
  readonly dropped: number;
  /** The run's liveness from the latest page, or `null` before the first. */
  readonly live: boolean | null;
  /** Whether a per-run cap refused entries — the transcript holds a marker saying so. */
  readonly elided: boolean;
  /** How many entries the latest page added — what the live region announces. */
  readonly added: number;
  /** The latest failure, or `null` while the last read worked. */
  readonly error: string | null;
  /** Whether the first page has been read. */
  readonly loaded: boolean;
}

/** Before the first page. */
export const EMPTY_TRANSCRIPT_VIEW: TranscriptView = Object.freeze({
  entries: Object.freeze([]) as readonly RunEventEntry[],
  dropped: 0,
  live: null,
  elided: false,
  added: 0,
  error: null,
  loaded: false,
});

/** How to build the stream. Everything is optional; production supplies none of it. */
export interface TranscriptStreamOptions extends PollOptions {
  /** How to read one page. Defaults to {@link requestEvents}. */
  readonly read?: TranscriptReader;
  /** The most entries to hold. Defaults to {@link MAX_HELD_ENTRIES}. */
  readonly maxEntries?: number;
}

/** The stream. */
export interface TranscriptStream {
  /** The latest view. Identity-stable until something changes. */
  snapshot(): TranscriptView;
  /** Hear about changes. @returns The way to stop hearing. */
  subscribe(listener: () => void): () => void;
  /** Start reading. @returns The way to stop. */
  start(): () => void;
  /** Ask now — after a steer, whose mirrored entry is already stored. */
  refresh(): void;
}

/**
 * Append a page's entries to what is held, keeping the newest `max`.
 *
 * @param held What is held, oldest first.
 * @param incoming The page's entries, in `seq` order.
 * @param cursor The last `seq` held — anything at or before it is already here.
 * @param max The most to hold.
 * @returns The new list, how many entries it gained, and how many old ones left to make room.
 */
export function appendEntries(
  held: readonly RunEventEntry[],
  incoming: readonly RunEventEntry[],
  cursor: number,
  max: number,
): {
  readonly entries: readonly RunEventEntry[];
  readonly added: number;
  readonly dropped: number;
} {
  const fresh = incoming.filter((entry) => entry.seq > cursor);
  if (fresh.length === 0) return { entries: held, added: 0, dropped: 0 };

  const joined = [...held, ...fresh];
  const dropped = Math.max(0, joined.length - Math.max(1, max));

  return { entries: dropped === 0 ? joined : joined.slice(dropped), added: fresh.length, dropped };
}

/**
 * Build the stream over one run's transcript.
 *
 * @param runId The run.
 * @param options Test seams; production passes none.
 * @returns The stream. It is inert until `start` is called.
 */
export function createTranscriptStream(
  runId: string,
  options: TranscriptStreamOptions = {},
): TranscriptStream {
  const read = options.read ?? requestEvents;
  const max = options.maxEntries ?? MAX_HELD_ENTRIES;

  let cursor = 0;
  let seen: RunEventsPage | null = null;
  let view: TranscriptView = EMPTY_TRANSCRIPT_VIEW;

  const listeners = new Set<() => void>();
  const poll = createPoll<RunEventsPage>(() => read(runId, cursor), options);
  let stopPoll: (() => void) | null = null;

  /**
   * Replace the view and tell everyone, unless nothing changed.
   *
   * @param next The candidate view.
   */
  function publish(next: TranscriptView): void {
    const keys = Object.keys(next) as (keyof TranscriptView)[];
    if (keys.every((key) => next[key] === view[key])) return;

    view = Object.freeze(next);
    for (const listener of [...listeners]) listener();
  }

  /** Fold the poll's latest answer in. */
  function onAnswer(): void {
    const answer = poll.snapshot();
    const page = answer.data;

    // A failure keeps what is held and says why; only a page not yet looked at is folded.
    if (page === null || page === seen || answer.error !== null) {
      publish({ ...view, error: answer.error });
      return;
    }

    seen = page;

    // Exact resume: anything that does not continue the transcript from the cursor is dropped.
    if (page.runId !== runId || page.after !== cursor) return;

    const appended = appendEntries(view.entries, page.entries, cursor, max);
    cursor = Math.max(cursor, page.nextAfter);

    publish({
      entries: appended.entries,
      dropped: view.dropped + appended.dropped,
      live: page.live,
      elided: page.elided,
      added: appended.added,
      error: null,
      loaded: true,
    });

    if (page.hasMore) {
      // After the loop has scheduled its timer, so the ask replaces the wait.
      queueMicrotask(() => poll.refresh());
    } else if (!page.live) {
      halt();
    }
  }

  /** Stop the loop. */
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

    refresh() {
      if (stopPoll !== null) poll.refresh();
    },
  };
}
