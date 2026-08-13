/**
 * The auth proxy — `/api/auth/*` on this origin, answered by `ouroboros-rest`.
 *
 * **Why the auth family is the one thing this module forwards rather than calls.** Every
 * other route of `ouroboros-rest` is reached server-side, through `app/api/client.ts` or
 * `app/api/auth-client.ts`, and its address never leaves the server — that is what
 * `OURO_REST_URL` carrying no `NEXT_PUBLIC_` prefix buys (`app/env.ts`). BetterAuth's routes
 * cannot all be reached that way, because two of them are travelled by *the browser itself*:
 *
 *   * `POST /api/auth/sign-in/social`, which a person's click begins, and
 *   * `GET /api/auth/callback/github`, which **github.com** redirects them back to.
 *
 * The second is why this file exists rather than a second base URL somewhere. GitHub sends
 * the browser to whatever the OAuth App is registered against, and that is
 * `${BETTER_AUTH_URL}/api/auth/callback/github` — `http://localhost:3000/...` in
 * `ouroboros-rest/.env`, this origin, not the service's. Without a forwarder the handshake's
 * last hop lands on the Next.js server, which serves no such route and answers `404`.
 *
 * Forwarding it here also puts the session cookies where the UI wants them: BetterAuth's
 * `Set-Cookie` arrives through this origin, so `better-auth.session_token` belongs to the UI
 * rather than to a second host, and `app/api/auth-client.ts` reads back a cookie a browser
 * actually sends. Cross-origin, that only works because a browser ignores the port when
 * matching `localhost` — a coincidence of development that no deployment can rely on.
 *
 * ### Why Proxy, and not `rewrites` in `next.config.ts`
 *
 * `rewrites()` is evaluated during `next build` and its destination is baked into
 * `routes-manifest.json`. `Dockerfile` builds this module **without** `OURO_REST_URL` on
 * purpose — "a build machine does not need the address of a service it is not calling" — so
 * a rewrite would freeze whatever the build host happened to have, which is nothing. Proxy
 * runs per request on the Node.js runtime (its default since Next.js 16, and not
 * configurable), so {@link restUrl} is read from the environment of the *running* container.
 * The same file therefore serves `yarn dev` against `localhost:4000` and a deployment
 * against an internal service address, with no rebuild between them.
 *
 * @see app/api/auth-client.ts — the same routes, called server-side, where the address stays
 *   on the server and this proxy is not involved.
 * @see ouroboros-rest/src/auth/auth.routes.ts — what is being forwarded to, route by route.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { restUrl } from "@/app/env";

/**
 * Forward one auth request to `ouroboros-rest`.
 *
 * The path is passed through unchanged rather than rebuilt from a captured segment: this
 * origin and the service agree on the `/api/auth` prefix, so `/api/auth/callback/github`
 * here is `/api/auth/callback/github` there, and a proxy that renamed paths would be one
 * more thing GitHub's registered callback has to agree with. `search` travels with it —
 * the OAuth callback *is* its query string, and dropping it would strip the `code` and the
 * `state` and fail the exchange at the last hop.
 *
 * @param request The incoming request, matched by {@link config}.
 * @returns A rewrite of it onto the service. Method, headers, body and cookies travel with
 *   the rewrite, and the service's answer — `Set-Cookie` included — is what the browser
 *   receives.
 */
export function proxy(request: NextRequest) {
  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, restUrl());

  return NextResponse.rewrite(target);
}

/**
 * The auth family, and nothing else.
 *
 * `/api/auth/:path*` rather than `/api/:path*`: `/api/v1` is called from the server, where
 * the generated client already has the address, and forwarding it would publish a route to
 * every `/api/v1` operation on this origin — an address the browser can compose calls to,
 * which is the property `OURO_REST_URL` is unprefixed to prevent.
 *
 * Written out rather than composed from `app/api/auth-client.ts`'s `AUTH_BASE_PATH`, which
 * is the same string: Next.js reads this matcher statically at build time, so an imported
 * constant leaves it unresolvable — and that module is `server-only` besides, which is a
 * boundary this file has no business dragging into the request path.
 */
export const config = {
  matcher: "/api/auth/:path*",
};
