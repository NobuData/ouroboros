import { LOOP_READINESS_UNAVAILABLE_CODE, readLoopReadiness, readinessQuery } from "@/app/api/loop-readiness";
import { pollResponse } from "@/app/api/poll-response";

/**
 * `GET /api/loop/readiness?repository=…&workflow=…[&issue=…]` — the wizard's readiness poll on
 * this origin (DK.2, [#1319](https://github.com/NobuData/ouroboros/issues/1319)), relayed to
 * REST's `GET /api/v1/loop/readiness` (DK.1) under the session.
 *
 * @param request The request.
 * @returns The preflight, or the poll family's failure answer.
 */
export async function GET(request: Request): Promise<Response> {
  return pollResponse(
    await readLoopReadiness(readinessQuery(new URL(request.url).searchParams)),
    LOOP_READINESS_UNAVAILABLE_CODE,
  );
}
