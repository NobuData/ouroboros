/**
 * The transcript's reader — one page of the tail, from the browser
 * ([#312](https://github.com/NobuData/ouroboros/issues/312)).
 *
 * `app/farm/log-poll.ts` is the same file for a build's log: the browser asks this origin for
 * the entries past the cursor it holds, and `transcript-stream.ts` folds the answer in.
 * Framework-free, so the guard and the reader are unit tests against a stubbed `fetch`.
 */

import type { RunEventsPage } from "@/app/api/runs";
import { type PollAnswer, requestPayload } from "@/app/poll";

import { RUN_ENDPOINT } from "./console-poll";

/** What is said when something answered and this client could not read it as a page. */
export const UNREADABLE_TRANSCRIPT = "The transcript could not be read.";

/** What is said when nothing answered at all. */
export const UNREACHABLE_TRANSCRIPT = "The transcript could not be reached.";

/** What this origin says about an `after` that is not a cursor. */
export const BAD_TRANSCRIPT_CURSOR = "A transcript is read from a whole, non-negative sequence number.";

/** One read of one page. Replaced wholesale in tests. */
export type TranscriptReader = (runId: string, after: number) => Promise<PollAnswer<RunEventsPage>>;

/**
 * The address for one page of a run's transcript.
 *
 * @param runId The run.
 * @param after The last `seq` held.
 * @returns `/api/runs/{id}/events?after=N`, the id encoded.
 */
export function eventsUrl(runId: string, after: number): string {
  return `${RUN_ENDPOINT}/${encodeURIComponent(runId)}/events?after=${String(after)}`;
}

/**
 * Whether a parsed body is one page of the tail.
 *
 * Checks what the stream reads — the cursors, the flags, the cadence, and that every entry has a
 * `seq`, a time and an actor — and nothing about the payloads, whose shapes vary by entry and are
 * each checked where they are drawn.
 *
 * @param value A parsed response body.
 * @returns `true` when it can be read as a {@link RunEventsPage}.
 */
export function isRunEventsPage(value: unknown): value is RunEventsPage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const page = value as Record<string, unknown>;

  return (
    typeof page.runId === "string" &&
    isCursor(page.after) &&
    isCursor(page.nextAfter) &&
    isCursor(page.latestSeq) &&
    typeof page.hasMore === "boolean" &&
    typeof page.live === "boolean" &&
    typeof page.elided === "boolean" &&
    typeof page.pollAfter === "number" &&
    Array.isArray(page.entries) &&
    page.entries.every(isEntryShape)
  );
}

/**
 * Whether a value is a whole, non-negative sequence number.
 *
 * @param value The value.
 * @returns `true` for one.
 */
function isCursor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Whether a value has what every entry is drawn from.
 *
 * @param value One element of `entries`.
 * @returns `true` when it has a `seq`, a `ts` and an `actor`.
 */
function isEntryShape(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;

  const entry = value as Record<string, unknown>;

  return isCursor(entry.seq) && typeof entry.ts === "string" && typeof entry.actor === "string";
}

/**
 * Read one page from the browser.
 *
 * @param runId The run.
 * @param after The last `seq` held.
 * @returns The answer. It does not throw, for the reason `requestPayload` gives.
 */
export function requestEvents(runId: string, after: number): Promise<PollAnswer<RunEventsPage>> {
  return requestPayload(eventsUrl(runId, after), null, isRunEventsPage, {
    unreachable: UNREACHABLE_TRANSCRIPT,
    unreadable: UNREADABLE_TRANSCRIPT,
  });
}
