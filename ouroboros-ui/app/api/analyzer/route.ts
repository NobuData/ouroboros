/**
 * `GET /api/analyzer?repo=owner/name[&origin=seeded]` — the Build Analyzer page's poll hop (BW.1,
 * [#516](https://github.com/NobuData/ouroboros/issues/516)). `origin` is the one data origin the
 * page reads (#2022); absent, `all` or unrecognized, it is `live` (`app/analyzer/analyzer-origin.ts`).
 *
 * The browser polls this origin, never `ouroboros-rest`: the session cookie rides along, and
 * the answer is the poll family's (`app/api/poll-response.ts`). A missing repository is a `400`
 * rather than a read the service would refuse anyway.
 */

import { ANALYZER_UNAVAILABLE_CODE, readAnalyzerPage } from "@/app/api/analyzer-page";
import { CACHE_CONTROL, pollResponse } from "@/app/api/poll-response";
import { ANALYZER_ORIGIN_PARAM, analyzerOrigin } from "@/app/analyzer/analyzer-origin";
import { ANALYZER_REPO_PARAM } from "@/app/analyzer/analyzer-poll";

/** The code a request naming no repository is answered with. */
export const ANALYZER_REPO_REQUIRED_CODE = "repo_required";

/**
 * Answer one poll.
 *
 * @param request The browser's request.
 * @returns The page, a `304`, a `401` once the session is over, or a `502` naming the failure.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const repo = params.get(ANALYZER_REPO_PARAM);

  if (repo === null || repo === "") {
    return Response.json(
      { code: ANALYZER_REPO_REQUIRED_CODE, message: "Name a repository, owner/name." },
      { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  return pollResponse(
    await readAnalyzerPage(repo, analyzerOrigin(params.get(ANALYZER_ORIGIN_PARAM))),
    ANALYZER_UNAVAILABLE_CODE,
  );
}
