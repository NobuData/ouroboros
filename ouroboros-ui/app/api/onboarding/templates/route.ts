import { pollResponse } from "@/app/api/poll-response";
import { TEMPLATES_UNAVAILABLE_CODE, readTemplatesPoll } from "@/app/api/templates-poll";
import { REPO_PARAM } from "@/app/get-started/view";

/**
 * `GET /api/onboarding/templates?repo=owner/name` — one repository's template tiles for the
 * `/get-started` poll (BC.3, [#392](https://github.com/NobuData/ouroboros/issues/392)).
 *
 * @param request The request, carrying the repository.
 * @returns The poll family's response.
 */
export async function GET(request: Request): Promise<Response> {
  const repo = new URL(request.url).searchParams.get(REPO_PARAM);

  return pollResponse(await readTemplatesPoll(repo), TEMPLATES_UNAVAILABLE_CODE);
}
