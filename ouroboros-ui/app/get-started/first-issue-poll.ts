/**
 * The first-issue card's poll (BC.4, [#393](https://github.com/NobuData/ouroboros/issues/393)) —
 * the I.8 poll family over `GET /api/onboarding/first-issue?repo=`, which forwards the card's one
 * read: BB.4's pick and ranking (#387) and the dry-run policy (BA.3, #382).
 *
 * The poll is what makes the safety rows **live**: the dry-run policy flipped in Settings — in
 * another tab, by another admin — reaches the row on the next answer, so the card never keeps
 * promising draft-only PRs to a workspace that now merges. It is also what lands the estimator's
 * sizes: a backlog read as *sizing* becomes a pick without a reload.
 */

import type { FirstIssueCard } from "@/app/api/onboarding";
import { type Poll, type PollOptions, createPoll, requestPayload } from "@/app/poll";

import { UNREACHABLE_FIRST_ISSUE, UNREADABLE_FIRST_ISSUE } from "./first-issue-view";
import { REPO_PARAM } from "./view";

/** Where the browser asks — **this origin**, not `ouroboros-rest`. */
export const FIRST_ISSUE_ENDPOINT = "/api/onboarding/first-issue";

/** How to build the poll. Everything is optional; production supplies none of it. */
export interface FirstIssuePollOptions extends PollOptions {
  /** How to make one read of an endpoint. Defaults to {@link requestFirstIssue}. */
  read?: (endpoint: string, etag: string | null) => ReturnType<typeof requestFirstIssue>;
}

/**
 * The endpoint for one repository's card.
 *
 * @param repo `owner/name`.
 * @returns `/api/onboarding/first-issue?repo=owner%2Fname`.
 */
export function firstIssueEndpoint(repo: string): string {
  return `${FIRST_ISSUE_ENDPOINT}?${REPO_PARAM}=${encodeURIComponent(repo)}`;
}

/**
 * Whether a value is shaped like a scored candidate — enough to draw a pick row.
 *
 * @param value What arrived.
 * @returns True for a candidate.
 */
function isCandidate(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;

  const { issueId, number, title, effort, suggestedWorkflow, reasoning } = value as Record<string, unknown>;

  return (
    typeof issueId === "string" &&
    typeof number === "number" &&
    typeof title === "string" &&
    typeof effort === "string" &&
    typeof suggestedWorkflow === "string" &&
    typeof reasoning === "object" &&
    reasoning !== null &&
    Array.isArray((reasoning as { fragments?: unknown }).fragments) &&
    Array.isArray((reasoning as { components?: unknown }).components)
  );
}

/**
 * Whether a payload is shaped like the card — enough to draw the pick, the ranking and the rows.
 *
 * @param value What arrived.
 * @returns True for the card.
 */
export function isFirstIssueCard(value: unknown): value is FirstIssueCard {
  if (typeof value !== "object" || value === null) return false;

  const { firstIssue, alternatives, dryRun } = value as Partial<Record<keyof FirstIssueCard, unknown>>;

  if (typeof firstIssue !== "object" || firstIssue === null) return false;
  if (typeof alternatives !== "object" || alternatives === null) return false;
  if (typeof dryRun !== "object" || dryRun === null || typeof (dryRun as { ok?: unknown }).ok !== "boolean") return false;

  const { state, backlog, pick, excluded } = firstIssue as Record<string, unknown>;
  const { candidates } = alternatives as Record<string, unknown>;

  return (
    typeof state === "string" &&
    typeof backlog === "object" &&
    backlog !== null &&
    typeof excluded === "object" &&
    excluded !== null &&
    (pick === null || isCandidate(pick)) &&
    Array.isArray(candidates) &&
    candidates.every(isCandidate)
  );
}

/**
 * One read of a repository's card on this origin.
 *
 * @param endpoint The endpoint, with its repository.
 * @param etag The last answer's entity tag, or null.
 * @returns The poll's answer.
 */
export function requestFirstIssue(endpoint: string, etag: string | null) {
  return requestPayload(endpoint, etag, isFirstIssueCard, {
    unreachable: UNREACHABLE_FIRST_ISSUE,
    unreadable: UNREADABLE_FIRST_ISSUE,
  });
}

/**
 * Build the poll for one repository's card.
 *
 * @param endpoint The endpoint.
 * @param options A stubbed reader, a fake clock — the test seams.
 * @returns The poll, not yet started.
 */
export function createFirstIssuePoll(endpoint: string, options: FirstIssuePollOptions = {}): Poll<FirstIssueCard> {
  const read = options.read ?? requestFirstIssue;

  return createPoll((etag) => read(endpoint, etag), options);
}
