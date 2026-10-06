import { DETECTION_UNAVAILABLE_CODE, readDetectionPoll } from "@/app/api/detection-poll";
import { pollResponse } from "@/app/api/poll-response";
import { REPO_PARAM } from "@/app/get-started/view";

/**
 * `GET /api/onboarding/detection?repo=owner/name` — one repository's detection card for the
 * `/get-started` poll (BC.2, [#391](https://github.com/NobuData/ouroboros/issues/391)).
 *
 * @param request The request, carrying the repository.
 * @returns The poll family's response.
 */
export async function GET(request: Request): Promise<Response> {
  const repo = new URL(request.url).searchParams.get(REPO_PARAM);

  return pollResponse(await readDetectionPoll(repo), DETECTION_UNAVAILABLE_CODE);
}
