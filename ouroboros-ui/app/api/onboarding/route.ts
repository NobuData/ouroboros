import { ONBOARDING_UNAVAILABLE_CODE, readOnboardingPoll } from "@/app/api/onboarding-poll";
import { pollResponse } from "@/app/api/poll-response";
import { REPO_PARAM } from "@/app/get-started/view";

/**
 * `GET /api/onboarding?repo=owner/name` — one repository's wizard for the `/get-started` poll
 * (BC.1, [#390](https://github.com/NobuData/ouroboros/issues/390)).
 *
 * @param request The request, carrying the repository.
 * @returns The poll family's response.
 */
export async function GET(request: Request): Promise<Response> {
  const repo = new URL(request.url).searchParams.get(REPO_PARAM);

  return pollResponse(await readOnboardingPoll(repo), ONBOARDING_UNAVAILABLE_CODE);
}
