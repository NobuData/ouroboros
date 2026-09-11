/**
 * The detail panel's poll — `app/poll.ts`'s loop over one issue
 * ([#119](https://github.com/NobuData/ouroboros/issues/119)).
 *
 * `app/issues/backlog-poll.ts` is the same file for the table, and the argument is the same
 * one issue narrower: *"`estimating` (skeleton breakdown that flips live)"* and *"the new
 * version renders without a manual refresh"* are both the browser asking, on the DASH-I.8
 * cadence, for the issue the panel has open, and drawing the last answer. The loop is the
 * generic one; what is here is the issue's reader, the guard that decides whether what answered
 * is an issue at all, and the two sentences a failed ask carries.
 *
 * **Framework-free**, so the reader is a unit test against a stubbed `fetch`;
 * `app/issues/use-detail-poll.ts` is where it meets React.
 */

import type { IssueDetail } from "@/app/api/backlog";
import {
  type Poll,
  type PollOptions,
  type PollReader,
  createPoll,
  requestPayload,
} from "@/app/poll";

/**
 * Where the browser asks — **this origin**, not `ouroboros-rest`, for the reason
 * `app/issues/backlog-poll.ts` gives for the listing's. The issue's id is the last segment, as
 * the contract's own path takes it.
 */
export const DETAIL_ENDPOINT = "/api/backlog";

/** What is said when something answered and this client could not read it as an issue. */
export const UNREADABLE_ISSUE = "The issue could not be read.";

/** What is said when nothing answered at all — a dropped connection, a timeout. */
export const UNREACHABLE_ISSUE = "The issue could not be reached.";

/** One read of the issue, as the loop needs it. Replaced wholesale in tests. */
export type DetailReader = PollReader<IssueDetail>;

/** How to build the panel's poll. Everything is optional; production supplies none of it. */
export interface DetailPollOptions extends PollOptions {
  /** How to make one read. Defaults to {@link requestDetail} over the poll's address. */
  read?: DetailReader;
}

/**
 * The address the panel polls for one issue.
 *
 * @param id The issue's `github_issues.id`.
 * @returns {@link DETAIL_ENDPOINT} with the id as its last segment, encoded — an id is a uuid
 *   and needs none, but an address built from a string a store handed over is encoded on
 *   principle.
 */
export function detailUrl(id: string): string {
  return `${DETAIL_ENDPOINT}/${encodeURIComponent(id)}`;
}

/**
 * Whether a parsed body is one issue in full.
 *
 * Structural rather than exhaustive, the way `isBacklogListing` is: the head reaches for
 * `issue`, the breakdown for `estimate` — an object or `null`, which is a state the panel
 * draws — and the trace for `history`, and a body carrying those is the issue for every
 * purpose this panel has. Checking it at all is the boundary between *the contract's type*
 * and *whatever answered on that URL*.
 *
 * @param value A parsed response body.
 * @returns `true` when it can be read as an {@link IssueDetail}.
 */
export function isIssueDetail(value: unknown): value is IssueDetail {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<IssueDetail>;
  const issue = candidate.issue as Partial<IssueDetail["issue"]> | undefined;

  return (
    typeof issue === "object" &&
    issue !== null &&
    typeof issue.id === "string" &&
    typeof issue.number === "number" &&
    typeof issue.title === "string" &&
    (candidate.estimate === null || typeof candidate.estimate === "object") &&
    Array.isArray(candidate.history)
  );
}

/**
 * A reader of one address, from the browser.
 *
 * @param url Where to ask — {@link detailUrl}'s answer.
 * @returns The reader. **It does not throw**, for the reason `requestPayload` gives.
 */
export function requestDetail(url: string): DetailReader {
  return (etag) =>
    requestPayload(url, etag, isIssueDetail, {
      unreachable: UNREACHABLE_ISSUE,
      unreadable: UNREADABLE_ISSUE,
    });
}

/**
 * Build the panel's loop over one address.
 *
 * @param url Where to ask — {@link detailUrl}'s answer. Ignored when `options.read` is given.
 * @param options Test seams; production passes none.
 * @returns The poll. It is inert until `start` is called.
 */
export function createDetailPoll(url: string, options: DetailPollOptions = {}): Poll<IssueDetail> {
  return createPoll(options.read ?? requestDetail(url), options);
}
