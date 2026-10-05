import { INBOX_SIDE_UNAVAILABLE_CODE, readInboxSide } from "@/app/api/inbox-side";
import { pollResponse } from "@/app/api/poll-response";

/**
 * `GET /api/inbox/side` — the inbox's side column for the `/inbox` page's poll (BO.4,
 * [#469](https://github.com/NobuData/ouroboros/issues/469)): the channels' truth and the policy
 * card, read together so the two cards always describe the same moment.
 *
 * @returns The poll family's response.
 */
export async function GET(): Promise<Response> {
  return pollResponse(await readInboxSide(), INBOX_SIDE_UNAVAILABLE_CODE);
}
