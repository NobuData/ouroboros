/**
 * `GET /api/providers/{id}/pulls` — the pull-list's poll
 * ([#230](https://github.com/NobuData/ouroboros/issues/230)).
 *
 * A route handler rather than a Server Action, for the reason `app/api/dashboard/route.ts`
 * gives at length: a poll is a `GET` a browser repeats every second or so while a transfer
 * moves, and a Server Action is a `POST` that cannot be cached, cancelled by navigation, or
 * told apart from a write in a network log. This origin is the only one the browser can reach,
 * so the handler asks `ouroboros-rest` with the session this request carries and passes the
 * answer through — the same record the service holds, which is what makes a reload land on
 * the transfer's real percentage.
 *
 * `anonymousApi` rather than `api`: a poll whose session has gone must answer `401` for the
 * list to stop, not redirect a `fetch` nobody is looking at.
 */

import { isApiError } from "@/app/api/errors";
import { providers } from "@/app/api/providers";
import { anonymousApi } from "@/app/api/server";

/**
 * What a browser is told about storing this answer: nothing shared may hold one workspace's
 * transfers, and a progress report kept for reuse is a report that stopped moving.
 */
export const CACHE_CONTROL = "private, no-store";

/**
 * Answer one poll.
 *
 * @param _request The poll.
 * @param context The connection, from the path.
 * @returns The pulls, or the service's refusal with its status — `401` for a session that has
 *   gone, `404` for a connection this workspace does not have.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  try {
    return Response.json(await providers.pulls(id, anonymousApi()), {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    if (!isApiError(error)) throw error;

    return Response.json(
      { code: error.code, message: error.message },
      { status: error.status, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }
}
