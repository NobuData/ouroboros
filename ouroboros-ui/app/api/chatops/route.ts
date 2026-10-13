import { CHATOPS_UNAVAILABLE_CODE, readChatOpsPage } from "@/app/api/chatops-page";
import { pollResponse } from "@/app/api/poll-response";

/**
 * `GET /api/chatops` — the Chat Ops page's poll (CA.1, #541): the Slack connection and the
 * workspace's channels in one answer, re-read every cadence so a revoked connection shows
 * without a reload.
 *
 * @returns The payload, or the poll's own account of why not.
 */
export async function GET(): Promise<Response> {
  return pollResponse(await readChatOpsPage(), CHATOPS_UNAVAILABLE_CODE);
}
