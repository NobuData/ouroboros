/**
 * The side column's poll (BO.4, [#469](https://github.com/NobuData/ouroboros/issues/469)) — the
 * I.8 poll family over `GET /api/inbox/side`, which forwards the channels' truth (BN.3, #463) and
 * the policy card (BN.4, #464).
 *
 * Neither card decides anything: a channel is connected when the service says so, and a rule is
 * listed while something enforces it. Polling is what lets both follow the deployment without a
 * reload — a channel that becomes available flips its row, a removed policy takes its row with
 * it, and dry-run changes the caption.
 */

import type { InboxSide } from "@/app/api/inbox";
import { type Poll, type PollOptions, type PollReader, createPoll, requestPayload } from "@/app/poll";

import { UNREACHABLE_SIDE, UNREADABLE_SIDE } from "./side-view";

/** Where the browser asks — **this origin**, not `ouroboros-rest`. */
export const INBOX_SIDE_ENDPOINT = "/api/inbox/side";

/** One read of the side column, as the loop needs it. Replaced wholesale in tests. */
export type SideReader = PollReader<InboxSide>;

/** How to build the poll. Everything is optional; production supplies none of it. */
export interface SidePollOptions extends PollOptions {
  /** How to make one read. Defaults to {@link requestSide}. */
  read?: SideReader;
}

/**
 * Whether a value is an object whose named fields are all strings.
 *
 * @param value The candidate.
 * @param fields The fields that must be strings.
 * @returns `true` when every one is.
 */
function hasStrings(value: unknown, fields: readonly string[]): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    fields.every((field) => typeof (value as Record<string, unknown>)[field] === "string")
  );
}

/**
 * Whether a payload is shaped like the side column — everything the two cards print.
 *
 * A row the cards could only half draw is refused whole: a channel with no state would be a row
 * with no standing, and that is the one thing the channels card may never guess.
 *
 * @param value What arrived.
 * @returns `true` for the channels and the policy card together.
 */
export function isInboxSide(value: unknown): value is InboxSide {
  if (typeof value !== "object" || value === null) return false;

  const { channels, policies } = value as { channels?: { channels?: unknown } | null; policies?: unknown };
  const rows = (policies as { rows?: unknown } | null | undefined)?.rows;

  return (
    Array.isArray(channels?.channels) &&
    channels.channels.every((channel) => hasStrings(channel, ["id", "label", "summary", "state"])) &&
    hasStrings(policies, ["caption"]) &&
    Array.isArray(rows) &&
    rows.every((row) => hasStrings(row, ["id", "rule", "outcome", "source", "editHref"]))
  );
}

/**
 * One read of the side column on this origin.
 *
 * @param etag The last answer's entity tag, or `null`.
 * @returns The poll's answer.
 */
export function requestSide(etag: string | null) {
  return requestPayload(INBOX_SIDE_ENDPOINT, etag, isInboxSide, {
    unreachable: UNREACHABLE_SIDE,
    unreadable: UNREADABLE_SIDE,
  });
}

/**
 * Build the side column's poll.
 *
 * @param options A stubbed reader, a fake clock — the test seams.
 * @returns The poll, not yet started.
 */
export function createSidePoll(options: SidePollOptions = {}): Poll<InboxSide> {
  return createPoll(options.read ?? requestSide, options);
}
