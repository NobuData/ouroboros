import { pollResponse } from "@/app/api/poll-response";
import { RESEARCH_SIDE_UNAVAILABLE_CODE, readResearchSide } from "@/app/api/research-side";

/**
 * `GET /api/research/side` — the Research side column's poll (CN.3, #629): the tools card and
 * the regression watch in one answer, re-read every health cycle.
 *
 * @returns The payload, or the poll's own account of why not.
 */
export async function GET(): Promise<Response> {
  return pollResponse(await readResearchSide(), RESEARCH_SIDE_UNAVAILABLE_CODE);
}
