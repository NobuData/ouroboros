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
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { type ApiClient, SESSION_COOKIE, createApiClient } from "@/app/api/client";
import { ACTIVE_TENANT_COOKIE, assertTenantReference, isTenantReference } from "@/app/api/tenant";
import { restUrl } from "@/app/env";

/**
 * Where a request with no usable session is sent.
 *
 * The route is [#44](https://github.com/NobuData/ouroboros/issues/44)'s; until it lands,
 * a `401` lands on a 404 rather than on a loop, which is the better of the two failures
 * while the screen does not exist.
 */
export const LOGIN_PATH = "/login";

/** How long the active-workspace cookie lives, in seconds — one year. */
export const ACTIVE_TENANT_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The workspace the signed-in person last chose, if it is still readable.
 *
 * A cookie is whatever the browser was last given, so a value that is not a workspace
 * reference is treated as *no choice* rather than as an error: the request then goes
 * without the header, and `ouroboros-rest` either infers the caller's sole workspace or
 * answers `422 tenant_required` — both of which are recoverable, where a throw here would
 * mean an edited cookie could stop the application rendering at all.
 *
 * @returns The slug or uuid, or `undefined` when there is no usable choice.
 */
export async function activeTenant(): Promise<string | undefined> {
  const value = (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value;
  return value !== undefined && isTenantReference(value) ? value : undefined;
}

/**
 * Remember the workspace to operate in, for this browser.
 *
 * Callable only where Next.js allows a cookie to be written — a Server Action or a Route
 * Handler — which is where a person choosing a workspace ends up anyway.
 *
 * `HttpOnly` because nothing in the browser reads this: the header is composed on the
 * server, and a value script can write is a value an XSS can point at another tenant's
 * workspace. `SameSite=Lax` for the same reason the session cookie uses it, and `Secure`
 * outside development, where there is no TLS to require.
 *
 * @param reference The workspace's slug or uuid.
 * @throws {Error} If the reference is not one the contract accepts — unlike a read, a
 *   write is this application's own doing and a bad value is a bug to surface.
 */
export async function setActiveTenant(reference: string): Promise<void> {
  (await cookies()).set(ACTIVE_TENANT_COOKIE, assertTenantReference(reference), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: ACTIVE_TENANT_MAX_AGE,
  });
}

/** Forget the chosen workspace — on sign-out, or when the person leaves it. */
export async function clearActiveTenant(): Promise<void> {
  (await cookies()).delete(ACTIVE_TENANT_COOKIE);
}

/** The session this request carries, if any, for forwarding to `ouroboros-rest`. */
async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
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
    tenant: activeTenant,
    session: sessionToken,
    onUnauthenticated: () => {
      // `redirect` signals by throwing, and that throw is the one that reaches Next.js —
      // which is the whole of "401 responses route to login". Nothing here catches it.
      redirect(LOGIN_PATH);
    },
  });
  return client;
}

/**
 * Forget the memoised client.
 *
 * Exported for tests, which need each case to build one against its own environment.
 * Production code has no reason to call it: the base URL of a running process does not
 * change.
 */
export function resetApiClient(): void {
  client = undefined;
}
