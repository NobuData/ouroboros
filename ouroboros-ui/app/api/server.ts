import "server-only";

/**
 * The client the application actually calls, and the store it reads the workspace from.
 *
 * `app/api/client.ts` is a factory that knows nothing about this application; this is the
 * one place that wires it to the real world — the configured base URL, the cookies of the
 * request being served, and the login screen a lost session goes to.
 *
 * **Server-side only**, and the `server-only` import above is what makes that a build
 * error rather than a bug. Two facts force it, and both are properties of the design
 * rather than accidents:
 *
 * - `OURO_REST_URL` carries no `NEXT_PUBLIC_` prefix, so it does not exist in the browser
 *   bundle (`app/env.ts`). An address the browser can read is an address a tenant can
 *   point elsewhere.
 * - The session cookie is `HttpOnly`. Script cannot read it, so only the server can
 *   forward it.
 *
 * So a screen fetches in a Server Component and passes data down, and a Client Component
 * that needs to *write* something calls a Server Action that calls this. That is the
 * shape the dashboard ([#45](https://github.com/NobuData/ouroboros/issues/45)) and the
 * login screen ([#44](https://github.com/NobuData/ouroboros/issues/44)) are built in.
 *
 * ### Neither client sends `X-Ouro-Tenant` any more
 *
 * Both did, from the `ouro_tenant` cookie, until
 * [#719](https://github.com/NobuData/ouroboros/issues/719). The header is an *override* since
 * [#713](https://github.com/NobuData/ouroboros/issues/713) — the session's active
 * organization is what scopes a request — and an override this application never means to
 * exercise is one it should not be sending: a cookie left over from a workspace somebody has
 * since switched away from, sent alongside a path naming the workspace they are actually in,
 * is `422 tenant_mismatch` on an operation that would otherwise have succeeded. The refusal
 * is correct and the request was this client's mistake.
 *
 * `app/api/client.ts` keeps the capability, because a client that *can* name a workspace is
 * what a future screen acting outside its own session would need. Nothing wires it today.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  type ApiClient,
  SESSION_COOKIES,
  type SessionCookies,
  createApiClient,
} from "@/app/api/client";
import { loginDestination } from "@/app/api/request";
import { ACTIVE_TENANT_COOKIE, assertTenantReference, isTenantReference } from "@/app/api/tenant";
import { restUrl } from "@/app/env";
import { LOGIN_PATH } from "@/app/paths";

/**
 * Where a request with no usable session is sent — the login screen
 * ([#44](https://github.com/NobuData/ouroboros/issues/44)).
 *
 * Re-exported from `app/paths.ts`, which is where the routes this application redirects to
 * are written down, because a pure module (`app/login/view.ts`) needs the same string and
 * cannot import this server-only one.
 *
 * That screen must not be sent to itself, which is what {@link anonymousApi} exists for:
 * it reads a `401` as *nobody is signed in* rather than as *go and sign in*.
 */
export { LOGIN_PATH };

/** How long the step-2 hint lives, in seconds — one year. */
export const ACTIVE_TENANT_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * ### `ouro_tenant` is a hint now, and no longer an authority
 *
 * It named the active workspace until
 * [#719](https://github.com/NobuData/ouroboros/issues/719): every request read it, matched
 * it against the session's memberships, and sent it on as `X-Ouro-Tenant`. That is now
 * `session."activeOrganizationId"` — server state, written by
 * `POST /api/auth/organization/set-active` and read by `ouroboros-rest`'s own middleware
 * ([#713](https://github.com/NobuData/ouroboros/issues/713)) — so the cookie was demoted
 * rather than deleted, and what is left of it answers exactly one question:
 *
 * > **Has this browser been through step 2 yet?**
 *
 * Nothing is *authorized* by the answer. Every session is stamped with an active
 * organization the moment it is created (`ouroboros-rest/src/auth/active.organization.ts`),
 * so "which workspace" is settled before the login screen renders and the only thing left to
 * know is whether the person has actually been asked where the loop runs — which is a fact
 * about a browser and belongs in a cookie. A visitor who deletes it is asked again; a
 * visitor who forges one lands on the dashboard they could have navigated to anyway.
 *
 * The value is still a workspace reference rather than a flag, because a browser holding
 * *which* workspace was last entered is what a switcher would read to preselect a row — but
 * nothing reads it that way today, and nothing may treat it as a claim about access.
 *
 * @returns The remembered reference, or `undefined` when there is none this module is
 *   willing to read back. An unreadable value is *no hint* rather than an error: a cookie is
 *   whatever the browser was last given, and a bad one must not be able to stop the
 *   application rendering.
 */
export async function workspaceHint(): Promise<string | undefined> {
  const value = (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value;
  return value !== undefined && isTenantReference(value) ? value : undefined;
}

/**
 * Remember that this browser has chosen where the loop runs.
 *
 * Callable only where Next.js allows a cookie to be written — a Server Action or a Route
 * Handler — which is where **Enter mission control →** ends up anyway.
 *
 * `HttpOnly` because nothing in the browser reads it, `SameSite=Lax` for the same reason the
 * session cookie uses it, and `Secure` outside development, where there is no TLS to
 * require. None of the three is load-bearing any more — see {@link workspaceHint} for what
 * this does and does not decide — and all three stay, because a cookie that script can read
 * is a cookie somebody will eventually decide something with.
 *
 * @param reference The workspace's slug or id, as the service reported it.
 * @throws {Error} If the reference is not one the contract accepts — unlike a read, a
 *   write is this application's own doing and a bad value is a bug to surface.
 */
export async function rememberWorkspace(reference: string): Promise<void> {
  (await cookies()).set(ACTIVE_TENANT_COOKIE, assertTenantReference(reference), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: ACTIVE_TENANT_MAX_AGE,
  });
}

/** Forget it — on sign-out, so the next person on this browser is asked step 2 again. */
export async function forgetWorkspace(): Promise<void> {
  (await cookies()).delete(ACTIVE_TENANT_COOKIE);
}

/**
 * The session cookies this request carries, for forwarding to `ouroboros-rest`.
 *
 * Both of BetterAuth's, not just the token: the second is the signed snapshot the service
 * answers from without a database lookup, so a client that dropped it would turn every call
 * into a query. `app/api/auth-server.ts` reads the same pair for the same reason.
 *
 * @returns The cookies present, or `undefined` when the browser sent neither.
 */
async function sessionCookies(): Promise<SessionCookies | undefined> {
  const jar = await cookies();

  const present: Record<string, string> = {};
  for (const name of SESSION_COOKIES) {
    const value = jar.get(name)?.value;
    if (value !== undefined) {
      present[name] = value;
    }
  }

  return Object.keys(present).length === 0 ? undefined : present;
}

/**
 * The process-wide client. Built on first use, not at import.
 *
 * One client serves every request because it holds no request state: the session and the
 * workspace are read *per call* by the resolvers below, from the cookies of whichever
 * request is being served at that moment. What it does hold is the base URL, which is
 * process-wide by definition.
 *
 * Lazy because {@link restUrl} throws when `OURO_REST_URL` is not set, and a module-level
 * client would raise that while `next build` prerenders a page that never calls the API.
 */
let client: ApiClient | undefined;

/** The same, for the one caller that must be allowed to hear a `401`. */
let anonymous: ApiClient | undefined;

/**
 * The client for `ouroboros-rest`, wired to this request's cookies.
 *
 * @returns The typed client. Every call resolves with the body the contract describes or
 *   rejects with an `ApiError` — except a `401`, which rejects with Next.js's own
 *   redirect signal and takes the request to the login screen instead.
 * @throws {Error} From {@link restUrl}, when `OURO_REST_URL` is unset or unusable.
 */
export function api(): ApiClient {
  client ??= createApiClient({
    baseUrl: restUrl(),
    session: sessionCookies,
    onUnauthenticated: async () => {
      // Awaited, and the handler is `async` for that one reason: where the request was
      // going is a header read ([#720](https://github.com/NobuData/ouroboros/issues/720)),
      // so the screen a person came for survives the round trip through the login page
      // instead of being replaced by the dashboard. `createApiClient` awaits this handler
      // before it throws, which is what makes the redirect below reachable at all.
      //
      // `redirect` signals by throwing, and that throw is the one that reaches Next.js —
      // which is the whole of "401 responses route to login". Nothing here catches it.
      redirect(await loginDestination());
    },
  });
  return client;
}

/**
 * The same client, minus the redirect.
 *
 * For a caller on the login screen, a `401` is an answer rather than an accident:
 * {@link api}'s handler would send the request to {@link LOGIN_PATH}, which is the page
 * asking — a redirect to itself, once per render, for every signed-out visitor.
 *
 * **Two modules call it.** `app/api/discovery.ts` is the obvious one:
 * [#712](https://github.com/NobuData/ouroboros/issues/712)'s `POST /api/v1/auth/discover` is
 * called from the login screen by a visitor who is signed in nowhere, which is exactly this
 * client's case. The second is `app/api/auth-server.ts`'s session read, which since
 * [#719](https://github.com/NobuData/ouroboros/issues/719) composes the workspace listing
 * into the session — a call made *while rendering the login screen*, on behalf of somebody
 * who is signed in. A `401` there cannot mean "go and sign in" without meaning "render this
 * page again", so it is left to reject and the route's error boundary shows it.
 *
 * Nothing else about it differs. It forwards the same session cookies, so a screen that uses
 * it while a session *does* exist sees exactly what {@link api} would have seen; a `401`
 * simply rejects with the `ApiError` the contract describes and the caller decides what it
 * means.
 *
 * @returns The typed client. Every call resolves with the body the contract describes or
 *   rejects with an `ApiError`, `401` included.
 * @throws {Error} From {@link restUrl}, when `OURO_REST_URL` is unset or unusable.
 */
export function anonymousApi(): ApiClient {
  anonymous ??= createApiClient({
    baseUrl: restUrl(),
    session: sessionCookies,
  });
  return anonymous;
}

/**
 * Forget the memoised clients.
 *
 * Exported for tests, which need each case to build one against its own environment.
 * Production code has no reason to call it: the base URL of a running process does not
 * change.
 */
export function resetApiClient(): void {
  client = undefined;
  anonymous = undefined;
}
