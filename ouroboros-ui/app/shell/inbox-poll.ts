/**
 * The Needs-You badge's poll — `app/poll.ts`'s loop over `GET /api/inbox/feed` (#461).
 *
 * The count moves whenever a plane files a decision or one is answered, so the browser asks this
 * origin's handler on the DASH-I.8 pattern ([#87](https://github.com/NobuData/ouroboros/issues/87)).
 * The loop — the interval the server names, the hidden tab, the sequence check — is the generic one;
 * what is here is the address, the guard that decides whether what answered is the feed at all, and
 * the two sentences a failed ask carries.
 *
 * **Framework-free**, so the reader is a unit test against a stubbed `fetch`.
 */

import type { InboxFeed } from "@/app/api/inbox";
import {
  type Poll,
  type PollOptions,
  type PollReader,
  type PollSnapshot,
  SESSION_ENDED,
  createPoll,
  requestPayload,
} from "@/app/poll";

/** Where the browser asks — **this origin**, not `ouroboros-rest`. */
export const INBOX_FEED_ENDPOINT = "/api/inbox/feed";

/** What a failed ask says when something answered and it was not the feed. */
export const UNREADABLE_INBOX = "The Needs-You count could not be read.";

/** What a failed ask says when nothing answered at all. */
export const UNREACHABLE_INBOX = "The Needs-You count could not be reached.";

/** How one read is made. */
export type InboxReader = PollReader<InboxFeed>;

/** How to build the poll — the reader is a test seam. */
export interface InboxPollOptions extends PollOptions {
  /** How to make one read. Defaults to {@link requestInboxFeed}. */
  read?: InboxReader;
}

/**
 * Whether a value is the feed — enough of it to draw the badge honestly.
 *
 * @param value What answered.
 * @returns `true` when it carries a whole-number `open` and the three severities.
 */
export function isInboxFeed(value: unknown): value is InboxFeed {
  if (typeof value !== "object" || value === null) return false;

  const { open, bySeverity, snoozed } = value as Partial<Record<keyof InboxFeed, unknown>>;

  if (typeof bySeverity !== "object" || bySeverity === null) return false;

  const { err, warn, info } = bySeverity as Record<string, unknown>;

  return [open, snoozed, err, warn, info].every(
    (count) => typeof count === "number" && Number.isInteger(count) && count >= 0,
  );
}

/**
 * Make one read of this origin's feed.
 *
 * @param etag The tag held, or `null`.
 * @returns The poll's answer.
 */
export function requestInboxFeed(etag: string | null) {
  return requestPayload(INBOX_FEED_ENDPOINT, etag, isInboxFeed, {
    unreachable: UNREACHABLE_INBOX,
    unreadable: UNREADABLE_INBOX,
  });
}

/**
 * Build the badge's poll.
 *
 * @param options The test seams; production passes none.
 * @returns The loop, not yet started.
 */
export function createInboxPoll(options: InboxPollOptions = {}): Poll<InboxFeed> {
  return createPoll(options.read ?? requestInboxFeed, options);
}

/**
 * The count the badge shows for a poll's state.
 *
 * @param snapshot The poll's state.
 * @returns `data.open`; or `null` — *nobody has counted* — before the first answer and once the
 *   session has ended (a count for a workspace this browser may no longer be in is not drawn). A
 *   plain failed ask keeps the last count.
 */
export function inboxBadgeCount(snapshot: PollSnapshot<InboxFeed>): number | null {
  if (snapshot.data === null || snapshot.error === SESSION_ENDED) return null;

  return snapshot.data.open;
}
