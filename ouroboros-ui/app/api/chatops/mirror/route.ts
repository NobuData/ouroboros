import { MIRROR_UNAVAILABLE_CODE, readChatOpsMirror } from "@/app/api/chatops-mirror";
import { pollResponse } from "@/app/api/poll-response";

/**
 * `GET /api/chatops/mirror?channel=<id>&before=<cursor>` — one page of a channel's mirror
 * (CA.2, #542): Ouroboros's record of what it published there and what was invoked. Without
 * `before` it is the latest page, which the card re-reads every cadence so a card published a
 * moment ago shows without a reload; with it, the page before that cursor.
 *
 * @param request The request, whose address names the channel and the cursor.
 * @returns The page, or the poll's own account of why not.
 */
export async function GET(request: Request): Promise<Response> {
  const asked = new URL(request.url).searchParams;

  return pollResponse(
    await readChatOpsMirror(asked.get("channel"), asked.get("before")),
    MIRROR_UNAVAILABLE_CODE,
  );
}
