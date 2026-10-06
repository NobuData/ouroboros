import { DEFAULTS_UNAVAILABLE_CODE, readDefaultsPoll } from "@/app/api/defaults-poll";
import { pollResponse } from "@/app/api/poll-response";
import { REPO_PARAM } from "@/app/get-started/view";

/**
 * `GET /api/onboarding/defaults?repo=owner/name` — one repository's right column for the
 * `/get-started` poll (BC.5, [#394](https://github.com/NobuData/ouroboros/issues/394)).
 *
 * @param request The request, carrying the repository.
 * @returns The poll family's response.
 */
export async function GET(request: Request): Promise<Response> {
  const repo = new URL(request.url).searchParams.get(REPO_PARAM);

  return pollResponse(await readDefaultsPoll(repo), DEFAULTS_UNAVAILABLE_CODE);
}
