/**
 * One poll answer, as the HTTP response a route handler on this origin sends back
 * ([#87](https://github.com/NobuData/ouroboros/issues/87), shared since
 * [#117](https://github.com/NobuData/ouroboros/issues/117)).
 *
 * `app/api/dashboard/route.ts` was the first route handler in this module and
 * `app/api/backlog/route.ts` is the second, and the translation between an answer and a
 * response is the same for both: a `304` must carry **no body at all** and still carry the
 * tag and the cadence hint, a failure must not be handed the tag of a payload it is not
 * carrying, and the session ending must be said plainly rather than redirected — a poll
 * parsing a login page as a payload is worse than a poll being told the session is over.
 * Written once here, so the two handlers cannot disagree about the contract's cheap half.
 *
 * **Framework-free and value-only**, the way `app/poll.ts` is: it builds a `Response` and
 * reads nothing from the request, the environment or the session. The reads that produce an
 * answer are the handlers' own, and they are `server-only`.
 */

import { ETAG_HEADER, POLL_AFTER_HEADER, type PollAnswer } from "@/app/poll";

/**
 * What a browser is told about storing a poll's answer — the same as the service says about
 * its own, because it is the same answer.
 *
 * `private` because it is one workspace's operational numbers and no shared cache may hold
 * them; `no-cache` because a browser may keep the body but must revalidate before reusing
 * it, which is precisely the loop this endpoint serves.
 */
export const CACHE_CONTROL = "private, no-cache";

/** The code a route handler answers a poll with when the session it carried is over. */
export const UNAUTHENTICATED_CODE = "unauthenticated";

/**
 * Turn one answer into the response the contract describes.
 *
 * Written out per case rather than composed, because the cases genuinely differ in what
 * they may carry.
 *
 * @param answer What the service said.
 * @param unavailableCode The code a failed read is reported under — this hop's own
 *   (`dashboard_unavailable`, `backlog_unavailable`), because the browser is talking to this
 *   origin and reporting somebody else's `500` as if it were ours would send a poll looking
 *   for a fault in the wrong place. The sentence beside it is the service's.
 * @returns The response for the browser.
 * @typeParam T What a fresh answer carries; it is serialised as JSON unchanged.
 */
export function pollResponse<T>(answer: PollAnswer<T>, unavailableCode: string): Response {
  switch (answer.state) {
    case "fresh":
      return Response.json(answer.payload, {
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
        { code: UNAUTHENTICATED_CODE, message: "This session is no longer signed in." },
        { status: 401, headers: { "Cache-Control": CACHE_CONTROL } },
      );

    case "failed":
      // `502`: something answered, and it was not an answer this origin could pass on.
      return Response.json(
        { code: unavailableCode, message: answer.reason },
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
