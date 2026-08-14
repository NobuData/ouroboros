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
 */

import { readDashboardSummary } from "@/app/api/dashboard-summary";
import {
  ETAG_HEADER,
  IF_NONE_MATCH_HEADER,
  POLL_AFTER_HEADER,
  type SummaryAnswer,
} from "@/app/dashboard/summary";

/**
 * What a browser is told about storing this answer — the same as the service says about its
 * own, because it is the same answer.
 *
 * `private` because it is one workspace's operational numbers and no shared cache may hold
 * them; `no-cache` because a browser may keep the body but must revalidate before reusing
 * it, which is precisely the loop this endpoint serves.
 */
export const CACHE_CONTROL = "private, no-cache";

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

  return respond(answer);
}

/**
 * Turn one answer into the response the contract describes.
 *
 * Written out per case rather than composed, because the cases genuinely differ in what
 * they may carry: a `304` must have **no body at all**, and a failure must not be given the
 * tag of a payload it is not carrying.
 *
 * @param answer What the service said.
 * @returns The response for the browser.
 */
function respond(answer: SummaryAnswer): Response {
  switch (answer.state) {
    case "fresh":
      return Response.json(answer.summary, {
        headers: passThrough(answer.etag, answer.pollAfterSeconds),
      });

    case "unchanged":
      // `null`, not an empty object: a `304` carrying a body is a `304` a client is entitled
      // to be confused by, and the point of this answer is that nothing was serialized.
      return new Response(null, {
        status: 304,
        headers: passThrough(answer.etag, answer.pollAfterSeconds),
      });

    case "gone":
      return Response.json(
        { code: "unauthenticated", message: "This session is no longer signed in." },
        { status: 401, headers: { "Cache-Control": CACHE_CONTROL } },
      );

    case "failed":
      // `502`: something answered, and it was not an answer this origin could pass on. The
      // status is this hop's own rather than the service's — the browser is talking to this
      // origin, and reporting somebody else's `500` as if it were ours would send a poll
      // looking for a fault in the wrong place. The sentence is the service's.
      return Response.json(
        { code: "dashboard_unavailable", message: answer.reason },
        {
          status: 502,
          headers: passThrough(null, answer.pollAfterSeconds),
        },
      );
  }
}

/**
 * The headers that travel back out unchanged.
 *
 * @param etag The tag the service sent, or `null` when this answer carries no payload to
 *   tag. Absent rather than empty — a client that stored `""` would revalidate against a
 *   tag no service ever issued.
 * @param pollAfterSeconds The cadence the service asked for, or `null` when it asked for
 *   nothing usable. Also absent rather than defaulted: the browser already knows the
 *   contract's default, and a hint invented here would be this origin's opinion wearing the
 *   service's header.
 * @returns The headers.
 */
function passThrough(
  etag: string | null,
  pollAfterSeconds: number | null,
): Record<string, string> {
  const headers: Record<string, string> = { "Cache-Control": CACHE_CONTROL };

  if (etag !== null && etag !== "") headers[ETAG_HEADER] = etag;
  if (pollAfterSeconds !== null) headers[POLL_AFTER_HEADER] = String(pollAfterSeconds);

  return headers;
}
