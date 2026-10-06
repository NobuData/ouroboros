import { FIRST_ISSUE_UNAVAILABLE_CODE, readFirstIssuePoll } from "@/app/api/first-issue-poll";
import { pollResponse } from "@/app/api/poll-response";
import { REPO_PARAM } from "@/app/get-started/view";

/**
 * `GET /api/onboarding/first-issue?repo=owner/name` — one repository's first-issue card for the
 * `/get-started` poll (BC.4, [#393](https://github.com/NobuData/ouroboros/issues/393)).
 *
 * @param request The request, carrying the repository.
 * @returns The poll family's response.
 */
export async function GET(request: Request): Promise<Response> {
  const repo = new URL(request.url).searchParams.get(REPO_PARAM);

  return pollResponse(await readFirstIssuePoll(repo), FIRST_ISSUE_UNAVAILABLE_CODE);
}
