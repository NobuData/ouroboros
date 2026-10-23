import "server-only";

import { type LoopReadiness, type LoopReadinessQuery, loop } from "@/app/api/loop";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_READINESS } from "@/app/get-started/readiness-view";
import { parseRepo } from "@/app/get-started/view";
import type { PollAnswer } from "@/app/poll";

/** The code a failed read answers with, through `/api/loop/readiness`. */
export const LOOP_READINESS_UNAVAILABLE_CODE = "loop_readiness_unavailable";

/** What a request without a usable query is told. */
export const LOOP_READINESS_QUERY_MISSING =
  "Name the repository and the workflow: ?repository=owner/name&workflow=slug.";

/** A workflow slug, as REST accepts it. */
const WORKFLOW_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The preflight's query, read from a request's search parameters.
 *
 * @param params The request's search parameters.
 * @returns The query, or null when the repository or workflow is missing or malformed.
 */
export function readinessQuery(params: URLSearchParams): LoopReadinessQuery | null {
  const repository = parseRepo(params.get("repository"));
  const workflow = params.get("workflow");
  const issue = params.get("issue");

  if (repository === null || workflow === null || !WORKFLOW_SHAPE.test(workflow)) return null;
  if (issue === null) return { repository, workflow };

  const number = Number(issue);

  return Number.isSafeInteger(number) && number > 0 ? { repository, workflow, issue: number } : null;
}

/**
 * Read the readiness preflight for the wizard's poll (DK.2, #1319).
 *
 * @param query The repository, workflow and issue, or null when the request named none.
 * @param read The read itself; the REST client unless a test stands one in.
 * @returns The poll's answer.
 */
export async function readLoopReadiness(
  query: LoopReadinessQuery | null,
  read: (query: LoopReadinessQuery, signal: AbortSignal) => Promise<LoopReadiness> = (asked, signal) =>
    loop.readiness(asked, anonymousApi(), signal),
): Promise<PollAnswer<LoopReadiness>> {
  if (query === null) {
    return { state: "failed", reason: LOOP_READINESS_QUERY_MISSING, pollAfterSeconds: null };
  }

  return readForPoll((signal) => read(query, signal), UNREACHABLE_READINESS);
}
