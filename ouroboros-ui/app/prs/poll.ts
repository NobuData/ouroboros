/**
 * The PR verification page's poll — `app/poll.ts`'s loop over one PR's page
 * ([#363](https://github.com/NobuData/ouroboros/issues/363)).
 *
 * `app/runs/console-poll.ts` is the same file for the run console, and the argument is the same:
 * the page is the browser asking, on the shared I.8 cadence
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)), for what it has open — so a gate that
 * turns green, a review somebody answered and a merge that landed all reach the head without a
 * reload.
 *
 * **One loop, because the service answers one page.** The head, the gates and the plan are read
 * together, so the pill cannot count gates of a revision the eyebrow does not name.
 *
 * **Framework-free**, so the reader is a unit test against a stubbed `fetch`; the screen meets it
 * through `app/issues/use-keyed-poll.ts`.
 */

import type { PullRequestPage } from "@/app/api/pull-requests";
import {
  type Poll,
  type PollOptions,
  type PollReader,
  createPoll,
  requestPayload,
} from "@/app/poll";

/** Where the browser asks for a PR's page — this origin, `/api/prs/:id`. */
export const PAGE_ENDPOINT = "/api/prs";

/** What is said when something answered and this client could not read it as a PR page. */
export const UNREADABLE_PAGE = "The pull request could not be read.";

/** What is said when nothing answered the read at all. */
export const UNREACHABLE_PAGE = "The pull request could not be reached.";

/** How to build the poll. Everything is optional; production supplies none of it. */
export interface PrPollOptions extends PollOptions {
  /** How to make one read. Defaults to the address's own reader. */
  read?: PollReader<PullRequestPage>;
}

/**
 * The address the page polls.
 *
 * @param prId The PR's id.
 * @returns `/api/prs/<id>`, the id encoded.
 */
export function pageUrl(prId: string): string {
  return `${PAGE_ENDPOINT}/${encodeURIComponent(prId)}`;
}

/**
 * Whether a parsed body is a PR page.
 *
 * Structural rather than exhaustive: the head reaches for `pullRequest`, `revisions`, `gates`,
 * `plan` and `review`, and a body carrying those is the page for every purpose the head has.
 *
 * @param value A parsed response body.
 * @returns `true` when it can be read as a {@link PullRequestPage}.
 */
export function isPullRequestPage(value: unknown): value is PullRequestPage {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<PullRequestPage>;
  const head = candidate.pullRequest as Partial<PullRequestPage["pullRequest"]> | undefined;

  return (
    typeof head === "object" &&
    head !== null &&
    typeof head.id === "string" &&
    typeof head.number === "number" &&
    typeof head.title === "string" &&
    typeof head.state === "string" &&
    Array.isArray(candidate.revisions) &&
    (candidate.gates === null ||
      (typeof candidate.gates === "object" && Array.isArray(candidate.gates.rows))) &&
    typeof candidate.plan === "object" &&
    candidate.plan !== null &&
    (candidate.review === null || typeof candidate.review === "object")
  );
}

/**
 * Build the page's loop over one PR.
 *
 * @param prId The PR's id.
 * @param options Test seams; production passes none.
 * @returns The poll. It is inert until `start` is called.
 */
export function createPagePoll(prId: string, options: PrPollOptions = {}): Poll<PullRequestPage> {
  const url = pageUrl(prId);
  const read: PollReader<PullRequestPage> =
    options.read ??
    ((etag) =>
      requestPayload(url, etag, isPullRequestPage, {
        unreachable: UNREACHABLE_PAGE,
        unreadable: UNREADABLE_PAGE,
      }));

  return createPoll(read, options);
}
