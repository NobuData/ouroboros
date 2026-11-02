import { FIRST_LOOP_UNAVAILABLE_CODE, readFirstLoop } from "@/app/api/first-loop";
import { pollResponse } from "@/app/api/poll-response";

/**
 * `GET /api/onboarding/first-loop?run=<id>` — the wizard's first loop on this origin (BD.1,
 * [#396](https://github.com/NobuData/ouroboros/issues/396)): the run, its PR, a budget stop and
 * the dry-run policy, composed under the session.
 *
 * @param request The request.
 * @returns The first loop, or the poll family's failure answer.
 */
export async function GET(request: Request): Promise<Response> {
  return pollResponse(await readFirstLoop(new URL(request.url).searchParams.get("run")), FIRST_LOOP_UNAVAILABLE_CODE);
}
