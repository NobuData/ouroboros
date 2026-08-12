/**
 * The parts of a platform request and response the auth routes touch, named rather than
 * imported.
 *
 * What they must *not* name is `express.Request`/`express.Response`: `application.ts` and
 * `error.filter.ts` both make the same choice for the same reason, which is that this
 * service has no opinion about its HTTP adapter and naming the handful of members it
 * actually uses is both the documentation and the whole of the coupling. Express's own
 * types satisfy these structurally, so nothing adapts anything; a spec satisfies them with
 * an object literal, which is why the tests beside this read as assertions about headers
 * rather than as mock bookkeeping.
 */

/** The header a cookie is set with. */
export const SET_COOKIE = "Set-Cookie";

/** The header a browser sends its cookies in. */
export const COOKIE = "cookie";

/** The request surface this module reads. */
export interface AuthRequest {
  /** The headers, as the adapter parsed them — lower-cased keys. */
  headers?: Record<string, string | string[] | undefined>;
}

/** The response surface this module writes. */
export interface AuthResponse {
  /**
   * Read a header back.
   *
   * Only `Set-Cookie` is ever read, and only so that {@link appendSetCookie} can add to it
   * rather than replace it — see there for why replacing is the bug this exists to avoid.
   */
  getHeader(name: string): number | string | string[] | undefined;
  /** Set a header, replacing any previous value. */
  setHeader(name: string, value: string | string[]): unknown;
  /** Set the status for an answer with no body. Chained with `end()`. */
  status(code: number): { end(): unknown };
}

/**
 * A request's cookies, in the vocabulary BetterAuth's server-side callers take.
 *
 * The library's `api.*` methods accept Fetch-API `Headers` rather than Node's header bag,
 * and `better-auth/node` ships a `fromNodeHeaders` that converts the whole of one. This
 * converts the one header that matters instead, deliberately: `auth.factory.ts` is the only
 * module in this service that names `better-auth` as a *value* — everything else reaches it
 * through types the compiler erases — and importing a second ES-module entry point here to
 * copy a single string would spend that arrangement for nothing.
 *
 * @param request - The request being handled.
 * @returns Headers carrying its `Cookie`, or empty when it sent none. Every server-side
 *   caller this service makes authenticates by cookie, so nothing else is copied; a caller
 *   that needs more should say which header and why rather than widening this.
 */
export function cookieHeaders(request: AuthRequest): Headers {
  const headers = new Headers();
  const cookie = request.headers?.[COOKIE];

  if (typeof cookie === "string") {
    headers.set(COOKIE, cookie);
  }

  return headers;
}

/**
 * Add a `Set-Cookie` to an answer without discarding the ones already on it.
 *
 * `setHeader` replaces, and this response can legitimately be written to twice: the legacy
 * cookie eviction (`legacy.cookie.ts`) runs as middleware, before any handler, and sign-out
 * writes BetterAuth's own removals afterwards. A second `setHeader` would silently drop the
 * first — which would look like the eviction "not working" on precisely the one route where
 * a stale cookie is most likely to be present.
 *
 * @param response - The answer being written.
 * @param values - The cookie strings to add. Each becomes its own `Set-Cookie` line; a
 *   comma-joined single header is legal for other headers and is not for this one.
 */
export function appendSetCookie(response: AuthResponse, values: readonly string[]): void {
  const existing = response.getHeader(SET_COOKIE);
  const already =
    existing === undefined
      ? []
      : Array.isArray(existing)
        ? existing.map(String)
        : [String(existing)];

  response.setHeader(SET_COOKIE, [...already, ...values]);
}
