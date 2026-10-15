/**
 * `GET /api/loop/capabilities` — the capability report, proxied for the shell's poll (DG.3, #1301).
 */

import { LOOP_CAPABILITIES_UNAVAILABLE_CODE, readLoopCapabilities } from "@/app/api/loop-capabilities";
import { pollResponse } from "@/app/api/poll-response";

/** @returns The report, `304` when unchanged, or the poll's designed failure. */
export async function GET(): Promise<Response> {
  return pollResponse(await readLoopCapabilities(), LOOP_CAPABILITIES_UNAVAILABLE_CODE);
}
