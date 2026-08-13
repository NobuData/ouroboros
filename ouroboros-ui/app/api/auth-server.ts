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
 * ### Who is signed in is three calls, and there is no fourth
 *
 * [#711](https://github.com/NobuData/ouroboros/issues/711) deleted `GET /api/v1/auth/me`,
 * which had been answering *who is signed in* beside BetterAuth's own session route: two
 * answers that could disagree, and the one built over `tenant_members` and `tenants` was
 * already answering nothing at all, because `V006__tenancy_extensions.sql` had dropped both
 * tables ([#708](https://github.com/NobuData/ouroboros/issues/708)). What replaces it is the
 * three routes the contract publishes, and they divide the question the way BetterAuth
 * models it:
 *
 * | Call | Answers |
 * |---|---|
 * | `organization.list` | the workspaces they belong to |
 * | `organization.getActiveMemberRole` | what they hold in one of them |
 * | `getSession` | the person, and which organization the session is acting in |
 *
 * The second is a call *per workspace*, and that is a cost worth naming: the plugin's
 * listing discards the role on the way out of the adapter, so there is no one request that
 * answers both. It is a handful of small reads on a login screen rather than a fan-out on a
 * hot path, and [#714](https://github.com/NobuData/ouroboros/issues/714)'s
 * `GET /api/v1/orgs` — the Step 2 row model, with counts and roles together — is the single
 * call that replaces them. [#719](https://github.com/NobuData/ouroboros/issues/719) is what
 * re-points this module at it.
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
  asRole,
  isoTimestamp,
  unwrap,
} from "@/app/api/auth-client";
import type { Session } from "@/app/api/identity";
import type { Membership } from "@/app/api/membership";
import { clearActiveTenant } from "@/app/api/server";
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
 * The current session, composed from the three calls that answer it.
 *
 * One function, because a screen has one question. That it is three requests is this
 * module's business and nobody else's.
 *
 * @param fetchImpl The fetch to call through. Defaults to the runtime's; the parameter is
 *   what lets a suite answer without a socket.
 * @returns The session, or **`null` when nobody is signed in**. `null` rather than a throw,
 *   because that is what `get-session` itself answers: the absence of a session is the
 *   answer a login screen is asking for, not a failure. This changed with
 *   [#711](https://github.com/NobuData/ouroboros/issues/711) — the route it replaced
 *   answered `401`, which every caller then had to translate.
 * @throws {AuthError} Any other refusal. A service that is failing is not a signed-out
 *   visitor, and rendering a sign-in screen for one would hide an outage behind a login
 *   form.
 * @throws Next.js's redirect signal, when the service answered `401` — see
 *   {@link authRead}.
 */
export async function readSession(fetchImpl: typeof fetch = fetch): Promise<Session | null> {
  const fetchOptions = await authFetchOptions(fetchImpl);

  const current = await authRead(authApi.getSession({ fetchOptions }), "/get-session");
  if (current === null) return null;

  const organizations = (await authRead(
    authApi.organization.list({ fetchOptions }),
    "/organization/list",
  )) ?? [];

  return {
    user: {
      id: current.user.id,
      email: current.user.email,
      displayName: current.user.name,
      avatarUrl: current.user.image ?? null,
      createdAt: isoTimestamp(current.user.createdAt),
      updatedAt: isoTimestamp(current.user.updatedAt),
    },
    memberships: await Promise.all(
      organizations.map((organization) => membershipOf(organization, fetchOptions)),
    ),
    tenantSuggestion: null,
  };
}

/**
 * Make one workspace the session's active organization.
 *
 * **This is the service's own record of the choice, and it is not yet the one this
 * application reads.** The active workspace is the `ouro_tenant` cookie today
 * (`app/api/server.ts`), matched against the memberships the service reports in the same
 * request; BetterAuth keeps its own `session.activeOrganizationId`, which is what scopes the
 * plugin's member and invitation routes. Setting both is what keeps the two from disagreeing
 * while [#719](https://github.com/NobuData/ouroboros/issues/719) makes `setActive` the sole
 * authority and retires the cookie.
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
 *    is a session a copied cookie still opens.
 * 2. Both auth cookies, from this response.
 * 3. The active workspace, so the next person to sign in on this browser does not inherit a
 *    choice they never made.
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
  await clearActiveTenant();

  redirect(loginPath());
}

/** One entry of `organization.list` — `openapi.yaml` § `Organization`. */
export interface AuthOrganization {
  id: string;
  name: string;
  slug: string;
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

/**
 * One organization, as the workspace switcher needs it.
 *
 * `status` is `active` for every row, and that is the plugin's model rather than a
 * placeholder: an organization has no lifecycle column. `tenants.status` did — `active`,
 * `suspended`, `deleted` — and `V006__tenancy_extensions.sql` did not carry it across,
 * because BetterAuth has nowhere to put it. So *every workspace the list returns is one you
 * can work in*, which is what `selectableMemberships` was filtering for; the filter stays,
 * because the field is still in the contract that
 * [#714](https://github.com/NobuData/ouroboros/issues/714) will re-introduce it from, and a
 * screen that stopped checking would be one that has to learn to again.
 *
 * @param organization One entry of the organization listing.
 * @param fetchOptions What every call in this request carries.
 * @returns The membership, with the role read for this workspace specifically.
 */
async function membershipOf(
  organization: AuthOrganization,
  fetchOptions: AuthFetchOptions,
): Promise<Membership> {
  const held = await authRead(
    authApi.organization.getActiveMemberRole({
      query: { organizationId: organization.id },
      fetchOptions,
    }),
    "/organization/get-active-member-role",
  );

  return {
    tenantId: organization.id,
    slug: organization.slug,
    displayName: organization.name,
    status: "active",
    // A role nobody could read degrades to `viewer` — see `asRole`, which is also what
    // widens the client's three defaults back to the four the contract publishes.
    role: asRole(held?.role),
  };
}
