/**
 * `GET /api/dashboard` — the conditional exchange, on the origin the browser can reach
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)).
 *
 * **The first route handler in this module, and the reason it is one.** Everything else the
 * UI reads, it reads while rendering: a Server Component calls `app/api/server.ts` and
 * passes data down, and a Client Component that needs to *write* calls a Server Action. The
 * poll is neither. It is the browser asking, on a timer, for the same payload every fifteen
 * seconds — and the two things that make it cheap are HTTP's, not React's:
 *
 * - **`If-None-Match` and `304`.** The whole point of `docs/ARCHITECTURE.md` § 5.4 is that
 *   an unchanged dashboard costs a version probe and headers. A Server Action would have to
 *   carry the tag as an argument and mime the answer as a return value — the same exchange
 *   with the status line rewritten as data, which is a second contract to keep in step with
 *   the first.
 * - **`X-Ouro-Poll-After`.** The cadence is a header on every answer, so the server can slow
 *   every open dashboard by changing one variable. It survives this hop intact.
 *
 * So the exchange stays HTTP end to end, and this handler is what makes it reachable: the
 * browser cannot call `ouroboros-rest` itself, because `OURO_REST_URL` carries no
 * `NEXT_PUBLIC_` prefix and is not in the bundle, and because the session cookie is
 * `HttpOnly` and script cannot forward it (`app/api/server.ts`).
 *
 * ### There is no session gate here, and that is not an oversight
 *
 * This handler forwards the request's own session cookies and answers what the service
 * answered. A visitor with no session gets the service's `401`, which is the same authority
 * every rendered screen is checked against — `requireWorkspace()` calls the same service
 * over the same cookies. A gate here could only ask a weaker question (*is a cookie
 * present*), and would let through everything the service then refuses. What it must not do
 * — and does not — is redirect: a poll parsing a login page as a dashboard is worse than a
 * poll being told plainly that the session is over, which is what `{state: "gone"}` is for.
 *
 * ### Not cached, by construction
 *
 * Route handlers are uncached by default in this version of Next.js
 * (`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`), and this
 * one reads request headers and cookies besides, which is request-time data. A cached poll
 * answer would be a pill reporting the loop as it was for whoever asked first.
 *
 * The translation from an answer to a response is `app/api/poll-response.ts`'s, shared with
 * the backlog's handler since [#117](https://github.com/NobuData/ouroboros/issues/117).
 */

import { readDashboardSummary } from "@/app/api/dashboard-summary";
import { pollResponse } from "@/app/api/poll-response";
import { IF_NONE_MATCH_HEADER } from "@/app/dashboard/summary";

export { CACHE_CONTROL } from "@/app/api/poll-response";

/** The code a failed read is reported under — this hop's own, not the service's. */
export const DASHBOARD_UNAVAILABLE_CODE = "dashboard_unavailable";

/**
 * Answer one poll.
 *
 * @param request The poll, carrying the tag it holds and the session it was made with.
 * @returns The payload with its tag, a bodyless `304`, or the failure as the service
 *   reported it — each in the shape `app/dashboard/summary-poll.ts` reads back.
 */
export async function GET(request: Request): Promise<Response> {
  const answer = await readDashboardSummary({
    etag: request.headers.get(IF_NONE_MATCH_HEADER),
  });

  return pollResponse(answer, DASHBOARD_UNAVAILABLE_CODE);
}
