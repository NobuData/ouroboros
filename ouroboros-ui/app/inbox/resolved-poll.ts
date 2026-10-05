/**
 * The resolved list's poll (BO.3, [#468](https://github.com/NobuData/ouroboros/issues/468)) — the
 * I.8 poll family over `GET /api/inbox/resolved`, which forwards `GET /api/v1/inbox/resolved`
 * (BN.4, #464).
 *
 * One poll per day on screen: the page keys it by the endpoint, so paging to another day swaps
 * the loop rather than re-aiming it, and today's list keeps filling in as decisions resolve —
 * by a person here, from mail, or by policy with nobody asked at all.
 */

import type { InboxResolved } from "@/app/api/inbox";
import { type Poll, type PollOptions, type PollReader, createPoll, requestPayload } from "@/app/poll";

import { RESOLVED_DAY_PARAM, UNREACHABLE_RESOLVED, UNREADABLE_RESOLVED, parseDay } from "./resolved-view";

/** Where the browser asks for today — **this origin**, not `ouroboros-rest`. */
export const INBOX_RESOLVED_ENDPOINT = "/api/inbox/resolved";

/** One read of a day, as the loop needs it. Replaced wholesale in tests. */
export type ResolvedReader = PollReader<InboxResolved>;

/** How to build the poll. Everything is optional; production supplies none of it. */
export interface ResolvedPollOptions extends PollOptions {
  /** How to make one read of an endpoint. Defaults to {@link requestResolved}. */
  read?: (endpoint: string, etag: string | null) => ReturnType<ResolvedReader>;
}

/**
 * Where the browser asks for a day.
 *
 * @param day A UTC day, or `null` for today. Anything that is not a date reads as today.
 * @returns `/api/inbox/resolved`, or the same with `?day=YYYY-MM-DD`.
 */
export function resolvedEndpoint(day: string | null): string {
  const asked = parseDay(day);

  return asked === null ? INBOX_RESOLVED_ENDPOINT : `${INBOX_RESOLVED_ENDPOINT}?${RESOLVED_DAY_PARAM}=${asked}`;
}

/**
 * Whether a payload is shaped like a resolved day — enough to draw the heading, the rows and the
 * pager.
 *
 * @param value What arrived.
 * @returns `true` for a day.
 */
export function isInboxResolved(value: unknown): value is InboxResolved {
  if (typeof value !== "object" || value === null) return false;

  const { day, count, rows, previousDay, nextDay } = value as Partial<Record<keyof InboxResolved, unknown>>;

  return (
    typeof day === "string" &&
    typeof count === "number" &&
    Array.isArray(rows) &&
    (previousDay === null || typeof previousDay === "string") &&
    (nextDay === null || typeof nextDay === "string")
  );
}

/**
 * One read of a day on this origin.
 *
 * @param endpoint Where to ask — {@link resolvedEndpoint}.
 * @param etag The last answer's entity tag, or `null`.
 * @returns The poll's answer.
 */
export function requestResolved(endpoint: string, etag: string | null) {
  return requestPayload(endpoint, etag, isInboxResolved, {
    unreachable: UNREACHABLE_RESOLVED,
    unreadable: UNREADABLE_RESOLVED,
  });
}

/**
 * Build a day's poll.
 *
 * @param endpoint The day's endpoint — the poll's key.
 * @param options A stubbed reader, a fake clock — the test seams.
 * @returns The poll, not yet started.
 */
export function createResolvedPoll(endpoint: string, options: ResolvedPollOptions = {}): Poll<InboxResolved> {
  const read = options.read ?? requestResolved;

  return createPoll((etag) => read(endpoint, etag), options);
}
