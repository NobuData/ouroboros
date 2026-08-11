/**
 * The parts of a platform response the auth routes write, named rather than imported.
 *
 * Three of the four routes here answer with something Nest's default serialiser cannot
 * produce — two redirects and a `204` — and all three set a cookie, so they take the
 * response object itself. What they must *not* take is `express.Response`: `application.ts`
 * and `error.filter.ts` both make the same choice for the same reason, which is that this
 * service has no opinion about its HTTP adapter and naming the four methods it actually
 * calls is both the documentation and the whole of the coupling. Express's `Response`
 * satisfies this structurally, so nothing adapts anything; a spec satisfies it with an
 * object literal, which is why the controller's tests read as assertions about headers
 * rather than as mock bookkeeping.
 */

/** The response surface the auth controller uses. */
export interface AuthResponse {
  /**
   * Set a header, replacing any previous value.
   *
   * `Set-Cookie` is passed an array when a route sets more than one cookie at once — which
   * the callback does, issuing the session and clearing the handshake in the same answer.
   * One call with both, rather than two calls that would have the second overwrite the
   * first.
   */
  setHeader(name: string, value: string | string[]): unknown;
  /** Send a redirect. The status is passed explicitly rather than defaulted to 302. */
  redirect(status: number, url: string): unknown;
  /** Set the status for an answer with no body. Chained with {@link AuthResponse.end}. */
  status(code: number): { end(): unknown };
}

/** The header a cookie is set with. */
export const SET_COOKIE = "Set-Cookie";
