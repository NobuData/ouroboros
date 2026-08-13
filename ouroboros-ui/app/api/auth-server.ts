import "server-only";

/**
 * The auth family, called from the server — and the session a screen reads.
 *
 * `app/api/auth-client.ts` is BetterAuth's client and knows nothing about a request; this is
 * the one place that wires it to the real world, exactly as `app/api/server.ts` does for the
 * generated family. Two things are supplied per call and neither exists in the browser's
 * copy of the client:
 *
 *   * **Base URL** — `OURO_REST_URL`, via `app/env.ts`, plus `AUTH_BASE_PATH`. The same
 *     origin the generated client uses, because both families are served by the same
 *     process; what differs is the prefix, `/api/auth` beside `/api/v1` rather than inside
 *     it. The browser's client instead calls this origin and lets `proxy.ts` forward it.
 *   * **Cookies** — `better-auth.session_token` and `better-auth.session_data`, forwarded
 *     from the request being served. Both, not just the first: the second is the signed
 *     five-minute snapshot the service answers a session from without a database lookup, and
 *     dropping it makes every call cost a query. The `credentials: "include"` a browser
 *     would need has no meaning here — this runs on the server and composes the header
 *     itself.
 *
 * **Server-side only**, and the `server-only` import is what makes that a build error rather
 * than a bug: `OURO_REST_URL` carries no `NEXT_PUBLIC_` prefix and the session cookies are
 * `HttpOnly`, so a browser could neither address the service nor authenticate to it.
 *
 * ### Who is signed in is two calls, and it used to be one more per workspace
 *
 * [#711](https://github.com/NobuData/ouroboros/issues/711) deleted `GET /api/v1/auth/me`,
 * which had been answering *who is signed in* beside BetterAuth's own session route: two
 * answers that could disagree, and the one built over `tenant_members` and `tenants` was
 * already answering nothing at all, because `V006__tenancy_extensions.sql` had dropped both
 * tables ([#708](https://github.com/NobuData/ouroboros/issues/708)). What replaced it was
 * three of BetterAuth's own routes — `getSession`, `organization.list`, and a
 * `getActiveMemberRole` **per workspace**, because the plugin's listing discards the role on
 * the way out of its adapter and no one call answered both.
 *
 * [#719](https://github.com/NobuData/ouroboros/issues/719) is what retired the fan-out. The
 * question now divides in two, and neither half grows with how many workspaces somebody
 * belongs to:
 *
 * | Call | Answers |
 * |---|---|
 * | `getSession` | the person, and which organization the session is acting in |
 * | `GET /api/v1/orgs` | every workspace they belong to — roles, counts, monogram and all |
 *
 * The second is [#714](https://github.com/NobuData/ouroboros/issues/714)'s, and it is the one
 * read `/api/v1` offers that the auth family cannot: a join and a grouped count over three
 * tables the organization plugin serves one of. It is called through the *generated* client
 * (`app/api/tenants.ts`), which is the contract's own rule — auth routes through the auth
 * client, everything else through the generated one — so this module reaches across the line
 * exactly once, to compose the one value both families describe.
 *
 * `app/api/access.ts` is what reads this on behalf of a screen; `app/api/identity.ts` is the
 * vocabulary the answer is composed into. What a membership *means* — which one a reference
 * resolves to, and who may change a workspace — is `app/api/membership.ts`, which is
 * framework-free so that both this and the screens can read the same rules.
 *
 * **Sign-in itself is not here.** Beginning a sign-in is a `POST` whose answer the *browser*
 * navigates to ([#702](https://github.com/NobuData/ouroboros/issues/702)), so it is a
 * request made from the browser rather than from here: `app/login/sign-in.ts`, over the same
 * origin `proxy.ts` forwards. Signing *out* is here, because it has a cookie of this
 * application's own to clear — see {@link signOutSession}.
 */

import { createAuthClient } from "better-auth/client";
import { organizationClient } from "better-auth/client/plugins";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  AUTH_BASE_PATH,
  AUTH_COOKIES,
  AuthError,
  type AuthResult,
  isoTimestamp,
  unwrap,
} from "@/app/api/auth-client";
import type { ApiClient } from "@/app/api/client";
import type { Session } from "@/app/api/identity";
import { WORKSPACE_LIMIT, tenants } from "@/app/api/tenants";
import { anonymousApi, forgetWorkspace } from "@/app/api/server";
import { restUrl } from "@/app/env";
import { loginPath } from "@/app/paths";

/**
 * The client this module calls through — the same library, configured for a server.
 *
 * **A second instance rather than the browser's**, and the reason is that they share nothing
 * a client holds. `better-auth/client` rather than `better-auth/react`: the hooks that entry
 * point adds exist to keep a *tab* in step — one shared session store, a refetch when the
 * window regains focus, a broadcast to the other tabs after a sign-out — and every one of
 * those is meaningless in a process that renders one request and forgets it. The browser's
 * copy also carries a `401` handler that navigates, which here would be a second answer to
 * the redirect {@link authRead} already makes.
 *
 * What is identical is the part that matters: `organizationClient()`, so both are typed
 * against the same route table, and `app/api/auth-client.ts` owns everything either of them
 * translates.
 *
 * The base URL and the cookies are **not** here, because they are per request rather than per
 * process — see {@link authFetchOptions}. A client holding this request's cookies would be a
 * client shared between two people.
 */
export const authApi = createAuthClient({ plugins: [organizationClient()] });

/**
 * What a server-side auth call needs beyond its arguments.
 *
 * Passed per call rather than baked into a second client, because they are per *request*
 * rather than per process: the cookies belong to whichever request is being served, and a
 * client holding them would be a client shared between two people.
 */
export interface AuthFetchOptions {
  readonly baseURL: string;
  readonly headers: Record<string, string>;
  readonly cache: RequestCache;
  readonly customFetchImpl: typeof fetch;
}

/**
 * The `Cookie` header for this request, carrying only the auth cookies.
 *
 * Only those two: a cookie the service has no use for is a cookie forwarded to a service
 * that might log it.
 *
 * @returns The header value, or `undefined` when the browser sent neither — in which case no
 *   header is sent at all, rather than an empty one.
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
 * The options every call in this module passes to the client.
 *
 * @param fetchImpl The fetch to call through. Defaults to the runtime's; the parameter is
 *   what lets a suite answer without a socket, in the same shape `createApiClient` takes
 *   one.
 * @returns The base URL, this request's cookies, and the two settings that are not
 *   negotiable — an uncached read, because a session is per person and per moment and a
 *   cached answer would be somebody else's.
 * @throws {Error} From `restUrl()`, when `OURO_REST_URL` is unset or unusable.
 */
export async function authFetchOptions(
  fetchImpl: typeof fetch = fetch,
): Promise<AuthFetchOptions> {
  const cookie = await authCookieHeader();

  return {
    baseURL: `${restUrl()}${AUTH_BASE_PATH}`,
    headers: cookie === undefined ? {} : { Cookie: cookie },
    cache: "no-store",
    customFetchImpl: fetchImpl,
  };
}

/**
 * The current session, composed from the two calls that answer it.
 *
 * One function, because a screen has one question. That it is two requests — one to each
 * family — is this module's business and nobody else's.
 *
 * The workspace listing is read through {@link anonymousApi} rather than through `api()`,
 * and the difference is the `401` handler: `api()` sends one to the login screen, and the
 * caller most likely to be here *is* the login screen. A session that `get-session` just
 * answered for cannot ordinarily be refused by the request after it — both carry the same
 * cookies — but "ordinarily" is not a property to hang a redirect loop on, so a refusal
 * rejects with the `ApiError` the contract describes and the route's error boundary shows
 * it.
 *
 * @param fetchImpl The fetch to call through. Defaults to the runtime's; the parameter is
 *   what lets a suite answer without a socket.
 * @param client The client the workspace listing is read through. Defaults to the wired
 *   server-side one; tests pass a client over a stub `fetch`.
 * @returns The session, or **`null` when nobody is signed in**. `null` rather than a throw,
 *   because that is what `get-session` itself answers: the absence of a session is the
 *   answer a login screen is asking for, not a failure. This changed with
 *   [#711](https://github.com/NobuData/ouroboros/issues/711) — the route it replaced
 *   answered `401`, which every caller then had to translate.
 * @throws {AuthError} Any other refusal from the auth family. A service that is failing is
 *   not a signed-out visitor, and rendering a sign-in screen for one would hide an outage
 *   behind a login form.
 * @throws {ApiError} What `ouroboros-rest` answered to the workspace listing.
 * @throws Next.js's redirect signal, when an auth route answered `401` — see
 *   {@link authRead}.
 */
export async function readSession(
  fetchImpl: typeof fetch = fetch,
  client: ApiClient = anonymousApi(),
): Promise<Session | null> {
  const fetchOptions = await authFetchOptions(fetchImpl);

  const current = await authRead(authApi.getSession({ fetchOptions }), "/get-session");
  if (current === null) return null;

  const workspaces = await tenants.list({ limit: WORKSPACE_LIMIT }, client);

  return {
    user: {
      id: current.user.id,
      email: current.user.email,
      displayName: current.user.name,
      avatarUrl: current.user.image ?? null,
      createdAt: isoTimestamp(current.user.createdAt),
      updatedAt: isoTimestamp(current.user.updatedAt),
    },
    memberships: workspaces.items,
    membershipTotal: workspaces.total,
    // BetterAuth's own types leave the field off the base session and the plugin widens it,
    // so it is read defensively rather than asserted: a build whose client is typed without
    // the organization plugin would otherwise report every session as acting nowhere.
    activeOrganizationId: current.session.activeOrganizationId ?? null,
    tenantSuggestion: null,
  };
}

/**
 * Make one workspace the session's active organization.
 *
 * **This is the authority, since [#719](https://github.com/NobuData/ouroboros/issues/719).**
 * It was one of two records of the same choice: this pointer, which scopes the plugin's own
 * routes, and the `ouro_tenant` cookie, which is what `app/api/access.ts` used to resolve a
 * workspace from. Two records that can disagree is one too many, and the one that could be
 * edited by whoever holds the browser was the wrong one to keep. So this writes
 * `session."activeOrganizationId"`, `ouroboros-rest` scopes a request from that same column
 * ([#713](https://github.com/NobuData/ouroboros/issues/713)), and the cookie is a hint about
 * *where somebody got to in the sign-in flow* rather than a claim about which workspace they
 * are in (`app/api/server.ts`).
 *
 * @param organizationId The workspace's id. **Resolve it against the caller's own
 *   memberships before calling** — `app/api/membership.ts`'s `activeMembership` — because an
 *   id taken from a form or a cookie is a claim rather than a fact.
 * @param fetchImpl The fetch to call through. Defaults to the runtime's.
 * @returns Nothing. The answer is the organization the session moved to, which the caller
 *   already holds a membership row for; re-reading it would be a second vocabulary for the
 *   same workspace.
 * @throws {AuthError} What the service answered — `403` for an organization the caller is
 *   not a member of, which is the check that makes this safe to call at all.
 */
export async function setActiveOrganization(
  organizationId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const fetchOptions = await authFetchOptions(fetchImpl);

  await authRead(
    authApi.organization.setActive({ organizationId, fetchOptions }),
    "/organization/set-active",
  );
}

/**
 * Sign out, and land on the login screen.
 *
 * **Three things are cleared, and only the first is BetterAuth's.** The library's own
 * `Set-Cookie` cannot reach the browser from here — this call is made by the *server*, so
 * the header arrives at this process and stops — which is why the cookies are deleted from
 * the response being composed rather than left to the service. And `ouro_tenant` is this
 * application's own, so nothing but this deletes it.
 *
 * 1. The session row, by calling `sign-out`. A session that is only forgotten by the browser
 *    is a session a copied cookie still opens. The active organization goes with it: the
 *    pointer lives *on* that row (`session."activeOrganizationId"`), so signing out is what
 *    forgets which workspace this browser was in.
 * 2. Both auth cookies, from this response.
 * 3. The step-2 hint, so the next person to sign in on this browser is asked where the loop
 *    runs rather than being sent straight past the question.
 *
 * Callable only where Next.js allows a cookie to be written — a Server Action or a Route
 * Handler — which is where signing out is triggered from anyway. The account menu that binds
 * a form to it is [#721](https://github.com/NobuData/ouroboros/issues/721); no `"use server"`
 * wrapper is written here, because a Server Action nothing submits to is a POST endpoint
 * published for nobody.
 *
 * @param fetchImpl The fetch to call through. Defaults to the runtime's.
 * @throws Next.js's redirect signal, always — to the login screen, with no return-to, since
 *   the page being left is one this browser may no longer see.
 */
export async function signOutSession(fetchImpl: typeof fetch = fetch): Promise<void> {
  const fetchOptions = await authFetchOptions(fetchImpl);

  // A refusal is not a reason to stay signed in on this browser. The row may already be
  // gone — an expired session answers `401` — and either way the cookies below are what
  // this request can actually do something about.
  await authApi.signOut({ fetchOptions }).catch(() => undefined);

  const jar = await cookies();
  for (const name of AUTH_COOKIES) {
    jar.delete(name);
  }
  await forgetWorkspace();

  redirect(loginPath());
}

/**
 * Read one answer, sending a `401` to the login screen on the way.
 *
 * The server half of "a `401` routes to `/login`", and the counterpart of the browser-side
 * handler in `app/api/auth-client.ts`. It carries **no return-to**: a Server Component
 * cannot read the URL it is rendering for, and the framework publishes no header that says
 * so. What fills the parameter today is the browser — which knows exactly where it was — and
 * `app/(auth)/login/page.tsx`, which honours whatever arrives. Giving the server the same
 * knowledge is a request-wide `proxy.ts` matcher, which is the middleware decision
 * [#720](https://github.com/NobuData/ouroboros/issues/720) owns.
 *
 * @param call The client method's promise.
 * @param path The route, relative to `AUTH_BASE_PATH`, for the message.
 * @returns The body, or `null` when the route answered with no content.
 * @throws {AuthError} For any refusal that is not a `401`.
 * @throws Next.js's redirect signal, for a `401`.
 */
export async function authRead<T>(
  call: Promise<AuthResult<T>>,
  path: string,
): Promise<T | null> {
  try {
    return unwrap(await call, path);
  } catch (error) {
    if (error instanceof AuthError && error.status === 401) {
      // `redirect` signals by throwing, and that throw is the one that reaches Next.js.
      // Nothing here catches it.
      redirect(loginPath());
    }
    throw error;
  }
}
