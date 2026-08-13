/**
 * The client for the **auth family** — `ouroboros-rest`'s `/api/auth/*` routes.
 *
 * `ouroboros-rest/openapi.yaml` § *This document describes two families* is the rule this
 * file exists to keep ([#711](https://github.com/NobuData/ouroboros/issues/711)): auth
 * routes are called through a client of their own, everything else through the client
 * generated from the contract (`app/api/client.ts`). They are **excluded from code
 * generation** — `app/api/schema.d.ts` has no entry for any of them, deliberately — so a
 * module that needs one cannot reach for `api()` even by accident.
 *
 * **This is a stand-in, and its replacement has an issue number.**
 * [#716](https://github.com/NobuData/ouroboros/issues/716) is *BetterAuth client & session
 * store*: `createAuthClient({plugins: [organizationClient()]})`, which is typed against the
 * library's own route table and brings `useSession()`, sign-in, sign-out and the org
 * actions with it. What is here is the smallest thing that lets the auth family be *read*
 * from a Server Component, written now because #711 deleted `GET /api/v1/auth/me` — the
 * route `app/api/session.ts` used to call — and the module had to keep working. When #716
 * lands, this file goes and `session.ts` moves onto the real client; the shapes below are
 * the ones the library returns, so that is a swap of transport rather than of vocabulary.
 *
 * Two settings are the whole of what it configures, and they are the two #711 asks this
 * issue to write down:
 *
 *   * **Base URL** — `OURO_REST_URL`, via `app/env.ts`. The same origin the generated
 *     client uses, because both families are served by the same process; what differs is
 *     the prefix, `/api/auth` beside `/api/v1` rather than inside it.
 *   * **Cookies** — `better-auth.session_token` and `better-auth.session_data`, forwarded
 *     from the request being served. Both, not just the first: the second is the signed
 *     five-minute snapshot the service answers a session from without a database lookup,
 *     and dropping it makes every call cost a query. The `credentials: "include"` a browser
 *     would need has no meaning here — this runs on the server and composes the header
 *     itself.
 *
 * **Server-side only**, and the `server-only` import is what makes that a build error
 * rather than a bug: `OURO_REST_URL` carries no `NEXT_PUBLIC_` prefix and the session
 * cookies are `HttpOnly`, so a browser could neither address the service nor authenticate
 * to it.
 *
 * @see app/api/session.ts — the one caller, and what it composes out of these calls.
 * @see app/api/client.ts — the other family, and the four things *it* adds.
 */

import "server-only";

import { cookies } from "next/headers";

import { restUrl } from "@/app/env";

/** Where BetterAuth answers, as `ouroboros-rest` mounts it (`src/auth/auth.options.ts`). */
export const AUTH_BASE_PATH = "/api/auth";

/**
 * The session cookie BetterAuth issues, and the signed snapshot that travels beside it.
 *
 * Named here rather than imported from `app/api/client.ts`, whose `SESSION_COOKIE` is still
 * `ouro_session` — #33's, which #703 replaced and which
 * [#720](https://github.com/NobuData/ouroboros/issues/720) re-points. Sharing the constant
 * would mean this file was wrong for as long as that one is.
 */
export const AUTH_COOKIES = ["better-auth.session_token", "better-auth.session_data"] as const;

/**
 * The `Cookie` header for this request, carrying only the auth cookies.
 *
 * Only those two: a cookie the service has no use for is a cookie forwarded to a service
 * that might log it.
 *
 * @returns The header value, or `undefined` when the browser sent neither — in which case
 *   no header is sent at all, rather than an empty one.
 */
async function authCookieHeader(): Promise<string | undefined> {
  const jar = await cookies();

  const present = AUTH_COOKIES.map((name) => jar.get(name)).filter(
    (cookie) => cookie !== undefined,
  );

  return present.length === 0
    ? undefined
    : present.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

/**
 * A failure one of the auth routes answered with.
 *
 * Separate from `ApiError` on purpose, and the separation is a fact about the service
 * rather than a preference: the `/api/v1` routes answer one envelope from one filter, and
 * these routes are BetterAuth's and compose their own failures — `{message, code}`, with
 * the library's screaming-case codes. A single class covering both would have to invent an
 * envelope for half its instances.
 *
 * @property status The HTTP status.
 * @property code The library's code, when it sent one.
 * @property path The route that failed, for the log line. No credentials are in it.
 */
export class AuthError extends Error {
  readonly name = "AuthError";

  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly path: string,
  ) {
    super(message);
  }
}

/** What BetterAuth's failures look like on the wire. */
interface AuthErrorBody {
  message?: string;
  code?: string;
}

/**
 * Call one auth route and read its JSON answer.
 *
 * @param path The route, relative to {@link AUTH_BASE_PATH} and beginning with a slash —
 *   e.g. `/get-session`. A query string may be included.
 * @param fetchImpl The fetch to use. Defaults to the runtime's; the parameter is what lets
 *   a test answer without a socket, in the same shape `createApiClient` takes one.
 * @returns The parsed body, typed as the caller declares. A `204` and an empty body both
 *   come back as `null`, which is also what BetterAuth answers `get-session` with for
 *   nobody — so a caller has one absence to handle rather than two.
 * @throws {AuthError} For any status outside `2xx`. **A `401` is not special here**: these
 *   routes answer `null` for *no session*, so a `401` means the request was refused, which
 *   is a different fact and one a caller should not read as "signed out".
 */
export async function authRead<T>(
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T | null> {
  const url = `${restUrl()}${AUTH_BASE_PATH}${path}`;
  const cookie = await authCookieHeader();

  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(cookie === undefined ? {} : { Cookie: cookie }),
    },
    // The session is per person and per moment; a cached answer would be somebody else's.
    cache: "no-store",
  });

  const text = await response.text();
  const body: unknown = text === "" ? null : JSON.parse(text);

  if (!response.ok) {
    const failure = (body ?? {}) as AuthErrorBody;
    throw new AuthError(
      response.status,
      failure.code,
      failure.message ?? `${AUTH_BASE_PATH}${path} answered ${response.status}`,
      `${AUTH_BASE_PATH}${path}`,
    );
  }

  return body as T | null;
}
