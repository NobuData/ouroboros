/**
 * The two things this origin does before Next.js sees a request: forward the auth family to
 * `ouroboros-rest`, and tell the server where the request was going.
 *
 * > **Naming.** Middleware is called Proxy from Next.js 16
 * > (`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`) — same file
 * > convention, same runtime, one per project. So `middleware.ts` is not missing from this
 * > module; it is this file, and **whether to gate routes in it** is the decision
 * > [#720](https://github.com/NobuData/ouroboros/issues/720) owns. See § *Why this file is
 * > not the auth gate*.
 *
 * ## 1. The auth proxy — `/api/auth/*` on this origin, answered by `ouroboros-rest`
 *
 * **Why the auth family is the one thing this module forwards rather than calls.** Every
 * other route of `ouroboros-rest` is reached server-side, through `app/api/client.ts` or
 * `app/api/auth-server.ts`, and its address never leaves the server — that is what
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
 * rather than to a second host, and `app/api/auth-server.ts` reads back a cookie a browser
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
 * ## 2. The request's own address, published to the server
 *
 * Added by [#720](https://github.com/NobuData/ouroboros/issues/720). **Next.js gives a
 * Server Component no way to learn the URL it is rendering for**, so every server-side
 * redirect to `/login` sent a bare path and lost the page the person had asked for; only the
 * browser's client (`app/api/auth-client.ts`) could fill `?next=`, because only the browser
 * knew. Proxy sees the URL, so it says so — one header, `app/api/request.ts` on both ends,
 * and `app/(auth)/login/page.tsx` honouring it exactly as it already did for the browser.
 *
 * ### Why this file is not the auth gate
 *
 * **Because the gate it would duplicate is already in the right place, and a second one
 * could only disagree with it.** The framework's own guidance is that an authorization check
 * belongs beside the data rather than at the edge or in a layout
 * (`node_modules/next/dist/docs/01-app/02-guides/authentication.md` § *Optimistic checks
 * with Proxy*, § *Layouts and auth checks*), and `requireWorkspace()` in
 * `app/api/access.ts` is that check: it returns the workspace a screen renders, so the page
 * that skipped the gate is also the page with nothing to draw. Four things follow.
 *
 * | | |
 * |---|---|
 * | **There is no protected content to flash.** | `app/(app)/dashboard/page.tsx` composes nothing until `requireWorkspace()` has returned, so no reading, no workspace and no person can reach the stream ahead of the check. That was this issue's original justification for middleware, and the structure already satisfies it. |
 * | **A check here could only be optimistic.** | Proxy runs on every prefetch, so it may not call the service; the most it could read is *a session cookie is present*, which is strictly weaker than *this person is a member of the workspace this screen renders*. It would let through everything the real gate then refuses, and refuse nothing the real gate would not. |
 * | **It would need a route list, and the filesystem already has one.** | `(app)` is a route group. Naming its members again here is a list that drifts the first time a screen is added — and drifts *silently*, since the real gate still holds. |
 * | **Nothing in `(app)` is static.** | `currentAccess()` opens with `connection()`, so every protected screen is per-request by construction. The one case the docs keep proxy checks for — static content shared between users — does not exist here. |
 *
 * **The one thing an edge gate would genuinely improve, stated rather than hidden.** A
 * signed-out deep link is answered as a `200` carrying a streamed redirect rather than as a
 * bare `307`: `app/(app)/dashboard/loading.tsx` opens a Suspense boundary, so Next.js
 * flushes the app shell and the skeleton before the gate resolves and the redirect arrives
 * mid-stream. The browser still lands on `/login?next=…`, and what was flushed is chrome —
 * but ~30KB of it. An edge gate would make that case a clean `307`. It would **not** make
 * the commoner case one: a visitor whose session merely expired still carries a cookie, so
 * an optimistic check passes them through to exactly the same stream. Fixing the rarer half
 * of a problem is not worth a second authority, which is what settled this.
 *
 * So what proxy does for authentication is carry a fact, not make a decision:
 * {@link REQUEST_PATH_HEADER}. Nothing reads it to answer *may this proceed*; it decides
 * where somebody lands after signing in, and `app/api/request.ts` says at length why a
 * forged one is uninteresting.
 *
 * @see app/api/auth-server.ts — the same routes, called server-side, where the address stays
 *   on the server and this proxy is not involved.
 * @see app/api/request.ts — the other end of {@link REQUEST_PATH_HEADER}.
 * @see ouroboros-rest/src/auth/auth.routes.ts — what is being forwarded to, route by route.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { REQUEST_PATH_HEADER } from "@/app/api/request";
import { restUrl } from "@/app/env";

/**
 * Where BetterAuth answers on both sides of this file.
 *
 * The same string as `app/api/auth-client.ts`'s `AUTH_BASE_PATH`, and written out here for
 * the reason {@link config} gives — a matcher cannot hold an imported constant. This copy is
 * what {@link proxy} branches on, and `__tests__/api/auth-client.test.tsx` asserts both
 * against that module's.
 */
const AUTH_PREFIX = "/api/auth";

/**
 * Next.js's own cache-busting parameter on a React Server Component request —
 * `NEXT_RSC_UNION_QUERY` in `node_modules/next/dist/client/components/app-router-headers.js`.
 *
 * It is appended by the router rather than by anything a person typed, so it is the one part
 * of a query string that must not survive into a return-to: `?next=/dashboard?_rsc=1a2b`
 * would send a browser to a URL carrying the framework's internals in its address bar.
 */
const RSC_PARAM = "_rsc";

/**
 * Handle one request: forward it, or stamp it.
 *
 * @param request The incoming request, matched by {@link config}.
 * @returns A rewrite onto `ouroboros-rest` for the auth family, and otherwise the request
 *   carried on to Next.js with one header added.
 */
export function proxy(request: NextRequest): NextResponse {
  return request.nextUrl.pathname.startsWith(AUTH_PREFIX)
    ? forward(request)
    : announce(request);
}

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
 * @param request The incoming request, under {@link AUTH_PREFIX}.
 * @returns A rewrite of it onto the service. Method, headers, body and cookies travel with
 *   the rewrite, and the service's answer — `Set-Cookie` included — is what the browser
 *   receives.
 */
function forward(request: NextRequest): NextResponse {
  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, restUrl());

  return NextResponse.rewrite(target);
}

/**
 * Carry the request on, telling the server where it was going.
 *
 * `NextResponse.next({request: {headers}})` rather than `NextResponse.next({headers})`: the
 * first makes the header readable *upstream*, by `headers()` in the render this request
 * becomes, and the second would send it to the browser — which is neither wanted nor
 * harmless, since it would put every visited path into a response the browser may cache.
 *
 * `set` rather than `append`, and that is the security-relevant word: the header is one a
 * caller can send too, and overwriting is what makes the value the server reads this file's
 * rather than the caller's. `app/api/request.ts` covers what is left — a value that arrives
 * on a path this file does not match is still filtered by `safeReturnTo`.
 *
 * @param request The incoming request, on any path but {@link AUTH_PREFIX}.
 * @returns The request, carried on with {@link REQUEST_PATH_HEADER} set.
 */
function announce(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(REQUEST_PATH_HEADER, requestAddress(request.nextUrl));

  return NextResponse.next({ request: { headers } });
}

/**
 * A request's URL as somewhere a browser could be sent back to.
 *
 * The path and its query, minus {@link RSC_PARAM}. Only the origin-relative part, because
 * that is all a return-to may ever be — `safeReturnTo` in `app/paths.ts` refuses anything
 * else, and composing an absolute URL here would be composing a value that is guaranteed to
 * be rejected.
 *
 * Exported so the one rule with an edge case in it is testable without a framework request.
 *
 * @param url The request's URL, or anything with its path and query.
 * @returns `/dashboard`, `/runs?status=failed` — never with a trailing `?` for an empty
 *   query, so that a page's address is one string rather than two spellings of it.
 */
export function requestAddress(url: Pick<URL, "pathname" | "search">): string {
  const query = new URLSearchParams(url.search);
  query.delete(RSC_PARAM);

  const search = query.toString();

  return search === "" ? url.pathname : `${url.pathname}?${search}`;
}

/**
 * What this file runs on: the auth family, and every page request.
 *
 * **The first entry** is the forwarder's. `/api/auth/:path*` rather than `/api/:path*`:
 * `/api/v1` is called from the server, where the generated client already has the address,
 * and forwarding it would publish a route to every `/api/v1` operation on this origin — an
 * address the browser can compose calls to, which is the property `OURO_REST_URL` is
 * unprefixed to prevent.
 *
 * **The second** is the stamper's, and it is written as an exclusion rather than as a list of
 * protected routes *on purpose*. A list would be the route table kept in two places, which is
 * the drift § *Why this file is not the auth gate* refuses. What is excluded instead is
 * everything that is not a page: `/api/*` (the forwarder's own prefix, and the generated
 * family, which the browser never calls), `/_next/*` (the framework's build output), and the
 * file extensions `public/` holds — `favicon.ico`, `manifest.webmanifest`,
 * `apple-touch-icon.png`, `icon-*.png`, `brand/*.png`.
 *
 * **Extensions rather than "any dot in the last segment", and the difference is the App
 * Router's own transport.** Next.js appends its `.rsc` and segment-prefetch suffixes to
 * whatever source is written here (`getMiddlewareMatchers` in
 * `node_modules/next/dist/build/analysis/get-page-static-info.js`), so a client-side
 * navigation to `/dashboard` arrives as `/dashboard.rsc` — which a blanket dot-exclusion
 * refuses, quietly dropping this file out of every navigation after the first. The adapter
 * strips the suffix again before {@link proxy} sees it
 * (`node_modules/next/dist/server/web/adapter.js` § `normalizeRscURL`), so what
 * {@link requestAddress} reads is the page's own path either way.
 *
 * Both entries are written out rather than composed from {@link AUTH_PREFIX} or from
 * `app/api/auth-client.ts`: Next.js reads this matcher statically at build time, so anything
 * but a literal leaves it unresolvable. The copies are held together by
 * `__tests__/api/auth-client.test.tsx` and `__tests__/proxy.test.ts` instead, which assert
 * these literals against the constants they duplicate — and compile this matcher with
 * Next.js's own function rather than trusting a regular expression by eye.
 */
export const config = {
  matcher: [
    "/api/auth/:path*",
    "/((?!api/|_next/|.*\\.(?:ico|png|svg|jpg|jpeg|gif|webp|avif|txt|xml|json|webmanifest)$).*)",
  ],
};
