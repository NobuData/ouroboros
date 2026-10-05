/**
 * The week's stat card's poll (BO.5, [#470](https://github.com/NobuData/ouroboros/issues/470)) —
 * the I.8 poll family over `GET /api/inbox/stats`, which forwards BN.4's weekly figures (#464).
 *
 * Polling is what lets the card follow the week: a decision answered anywhere moves the count and
 * may move the median, and both arrive without a reload. Its poll is its own, so a slow or failing
 * stats read never holds the queue or the side column back.
 */

import type { InboxStats } from "@/app/api/inbox";
import { type Poll, type PollOptions, type PollReader, createPoll, requestPayload } from "@/app/poll";

import { UNREACHABLE_STATS, UNREADABLE_STATS } from "./stats-view";

/** Where the browser asks — **this origin**, not `ouroboros-rest`. */
export const INBOX_STATS_ENDPOINT = "/api/inbox/stats";

/** One read of the stat card, as the loop needs it. Replaced wholesale in tests. */
export type StatsReader = PollReader<InboxStats>;

/** How to build the poll. Everything is optional; production supplies none of it. */
export interface StatsPollOptions extends PollOptions {
  /** How to make one read. Defaults to {@link requestStats}. */
  read?: StatsReader;
}

/**
 * Whether a value is a number or `null` — a figure, or the service's *nothing to measure*.
 *
 * @param value The candidate.
 * @returns `true` for either.
 */
function isFigure(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

/**
 * Whether a payload is shaped like the week's stat card — everything the card prints.
 *
 * The three printed strings are what the card draws, so a payload without any one of them is
 * refused whole: a card that drew two of three claims would be making a different claim.
 *
 * @param value What arrived.
 * @returns `true` for the week's figures with their printing.
 */
export function isInboxStats(value: unknown): value is InboxStats {
  if (typeof value !== "object" || value === null) return false;

  const stats = value as Record<string, unknown>;
  const display = stats.display as Record<string, unknown> | null | undefined;

  return (
    typeof stats.week === "string" &&
    isFigure(stats.decisions) &&
    isFigure(stats.medianAnswerSeconds) &&
    isFigure(stats.maxLoopWaitSeconds) &&
    typeof display === "object" &&
    display !== null &&
    ["decisions", "medianAnswer", "maxLoopWait"].every((field) => typeof display[field] === "string")
  );
}

/**
 * One read of the stat card on this origin.
 *
 * @param etag The last answer's entity tag, or `null`.
 * @returns The poll's answer.
 */
export function requestStats(etag: string | null) {
  return requestPayload(INBOX_STATS_ENDPOINT, etag, isInboxStats, {
    unreachable: UNREACHABLE_STATS,
    unreadable: UNREADABLE_STATS,
  });
}

/**
 * Build the stat card's poll.
 *
 * @param options A stubbed reader, a fake clock — the test seams.
 * @returns The poll, not yet started.
 */
export function createStatsPoll(options: StatsPollOptions = {}): Poll<InboxStats> {
  return createPoll(options.read ?? requestStats, options);
}
