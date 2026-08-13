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
 * **This is BetterAuth's own client** since
 * [#716](https://github.com/NobuData/ouroboros/issues/716), where a hand-written `authRead`
 * stood in for it. `createAuthClient` is typed against the library's route table rather than
 * against a set of interfaces written here from the published contract, so a route that
 * changes shape is a compile error in this module rather than a field that silently reads
 * `undefined`. The organization plugin adds the other half — `organization.list`,
 * `setActive`, `getActiveMemberRole`, `getFullOrganization` — under the same typing, which
 * is the second reason the plugin is configured here rather than assumed.
 *
 * ### This is the browser's client, and the server has one of its own
 *
 * The routes are the same and the vocabulary is the same; almost nothing else is, which is
 * why `app/api/auth-server.ts` builds a second instance rather than importing this one:
 *
 * | | Browser — {@link authClient} | Server — `auth-server.ts`'s `authApi` |
 * |---|---|---|
 * | **Address** | this origin, `/api/auth`, which `proxy.ts` forwards | `OURO_REST_URL`, which the browser must never learn |
 * | **Cookies** | the browser's own, `credentials: "include"` | composed by hand from the request being served |
 * | **Entry point** | `better-auth/react` — one session store per tab, refetched on focus, broadcast between tabs | `better-auth/client` — a process that renders one request and forgets it |
 * | **A `401`** | navigates, here | Next.js's redirect signal, there |
 *
 * What they *do* share is this file: the base path, the cookie names, the error shape, and
 * the two translations below. Those are the things that would be wrong in two places if each
 * client kept its own.
 *
 * This module is not `server-only` and must not become so — `useSession()` is a React hook
 * and belongs in the browser.
 *
 * ### Why the browser is not given an address at all
 *
 * {@link authClient}'s base URL is this origin, which is a fact the browser already has. The
 * service's address is deliberately not reachable from here: `OURO_REST_URL` carries no
 * `NEXT_PUBLIC_` prefix (`app/env.ts`), because an address the browser can read is an
 * address a tenant can point elsewhere. `proxy.ts` is what closes the gap — it forwards
 * `/api/auth/*` on this origin to the service — and it has to exist regardless, because
 * github.com redirects the *browser* back to `/api/auth/callback/github` at the end of a
 * sign-in.
 *
 * @see app/api/auth-server.ts — the server's own instance, and the session a screen reads.
 * @see app/api/client.ts — the other family, and the four things *it* adds.
 * @see proxy.ts — how a browser-side call reaches the service at all.
 */

import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { ROLES, type Role } from "@/app/api/membership";
import { LOGIN_PATH, loginPath } from "@/app/paths";

/**
 * Where BetterAuth answers, as `ouroboros-rest` mounts it (`src/auth/auth.options.ts`).
 *
 * The same prefix on both sides of `proxy.ts`, which is what lets one constant serve the
 * browser's same-origin calls and the server's calls to `OURO_REST_URL` alike. `proxy.ts`
 * writes the string out again rather than importing it, and says why.
 */
export const AUTH_BASE_PATH = "/api/auth";

/**
 * The session cookie BetterAuth issues, and the signed snapshot that travels beside it.
 *
 * Named here rather than imported from `app/api/client.ts`, which since
 * [#720](https://github.com/NobuData/ouroboros/issues/720) forwards the same pair under the
 * same names — that module's `SESSION_COOKIES`. The duplication is deliberate and is the
 * thing keeping the two families independent: this file may not import from a module built
 * over the generated client, because the auth family is excluded from code generation and
 * importing across that line is what the rule exists to prevent. The names are wire
 * contract, like the paths beside them, and `client.test.ts` asserts the other copy against
 * the same literal.
 *
 * Read on the server (`app/api/auth-server.ts`), never here: both are `HttpOnly`, so script
 * cannot see them and the browser sends them by itself.
 */
export const AUTH_COOKIES = ["better-auth.session_token", "better-auth.session_data"] as const;

/**
 * A failure one of the auth routes answered with.
 *
 * Separate from `ApiError` on purpose, and the separation is a fact about the service rather
 * than a preference: the `/api/v1` routes answer one envelope from one filter, and these
 * routes are BetterAuth's and compose their own failures — `{message, code}`, with the
 * library's screaming-case codes. A single class covering both would have to invent an
 * envelope for half its instances.
 *
 * @property status The HTTP status. `0` when the request never got an answer at all.
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

/**
 * What every method on {@link authClient} resolves with.
 *
 * BetterAuth reports a refusal in the value rather than by rejecting, which is a third
 * outcome at every call site. {@link unwrap} is what collapses it back to the two this
 * module's other client already has — a body, or a throw.
 */
export interface AuthResult<T> {
  readonly data: T | null;
  readonly error: {
    readonly status?: number;
    readonly statusText?: string;
    readonly message?: string;
    readonly code?: string;
  } | null;
}

/**
 * Read one answer, or throw what refused it.
 *
 * @param result What a client method resolved with.
 * @param path The route that was called, relative to {@link AUTH_BASE_PATH} — for the
 *   message only, so a log line names the call rather than the layer.
 * @returns The body. **`null` is an answer rather than an absence**: `get-session` replies
 *   `null` for nobody signed in, and `get-active-member-role` for a workspace the caller
 *   holds nothing in, so a caller has one absence to handle rather than two.
 * @throws {AuthError} For anything the service refused. **A `401` is not special here**:
 *   these routes answer `null` for *no session*, so a `401` means the request itself was
 *   refused, which is a different fact and one no caller should read as "signed out".
 */
export function unwrap<T>(result: AuthResult<T>, path: string): T | null {
  const { data, error } = result;

  if (error !== null && error !== undefined) {
    const route = `${AUTH_BASE_PATH}${path}`;
    throw new AuthError(
      error.status ?? 0,
      error.code,
      error.message ?? `${route} answered ${error.status ?? "no status"}`,
      route,
    );
  }

  return data;
}

/**
 * A timestamp as the string every screen in this module renders.
 *
 * The client's types say `Date` and the wire says ISO-8601 — the library revives nothing, so
 * what actually arrives is the string. Both are accepted rather than one asserted away, so
 * the value is the same whichever is true and a change of mind upstream is a no-op rather
 * than a screen printing `[object Object]`.
 *
 * @param value What a route reported.
 * @returns The ISO-8601 string.
 */
export function isoTimestamp(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

/**
 * A role as this installation defines it.
 *
 * **The client's own type is narrower than the service's, and this is the seam.** The
 * organization plugin's client is typed against the library's *default* roles — `owner`,
 * `admin`, `member` — because the type that would widen them lives on `ouroboros-rest`'s
 * `auth` instance, and the two modules do not build together. `ouroboros-rest` configures a
 * fourth (`src/auth/organization.roles.ts`), the contract publishes all four
 * (`openapi.yaml` § `MemberRole`), and a `viewer` therefore arrives at a client that does not
 * expect it. Checking the string against the contract's list is what makes that safe in both
 * directions: a role the service adds later reads as the least it grants rather than as a
 * role this UI would render controls for.
 *
 * @param value Whatever the service called the role.
 * @returns The role, or **`viewer`** for anything unrecognised — the least this API grants,
 *   because a screen that guessed high would render a control the service then refuses.
 */
export function asRole(value: string | undefined): Role {
  // Widened to `string[]` for the test rather than the value narrowed to `Role` for it: the
  // whole question is whether a string that is *not* yet a `Role` happens to be one.
  return (ROLES as readonly string[]).includes(value ?? "") ? (value as Role) : "viewer";
}

/**
 * Where the browser sends an auth call, or `undefined` while there is no browser.
 *
 * This module is evaluated on the server too — Next.js renders Client Components there
 * first — and `window` does not exist during that pass. Returning `undefined` then is safe
 * because nothing *calls* this client in it: `useSession()`'s store does not fetch while
 * server-side rendering, and a Server Component that wants a session reads it through
 * `app/api/auth-server.ts`, which has an instance of its own. Composing an address from
 * `OURO_REST_URL` here instead would bake the service's address into a module the browser
 * downloads.
 *
 * @returns This origin, or `undefined` when there is no `window` to read it from.
 */
function browserOrigin(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.origin;
}

/**
 * Where a browser should go when the auth family refuses it — or nowhere.
 *
 * The browser half of "a `401` routes to `/login`" — the rule `app/api/server.ts` already
 * keeps for the generated family, kept here for the same reason and in the same words. The
 * server half is `app/api/auth-server.ts`, which redirects through Next.js instead.
 *
 * **The decision is a function and the navigation is one line**, the way
 * `app/login/sign-in.ts` splits the same problem: `window.location.assign` is the one part
 * that cannot be exercised without a browser, so nothing but the assignment lives on the
 * other side of it.
 *
 * Two answers are *nowhere*, and both would otherwise be loops. A `401` **while already on
 * the login screen** is that screen's own answer — a sign-in that was refused — and
 * navigating would replace the message the card is about to render with a page reload. And
 * anything that is not a `401` is somebody else's business: these routes answer `null` for
 * *no session*, so a `403` or a `500` is a refusal to report rather than a session to renew.
 *
 * @param status The status the service answered.
 * @param from Where the browser is, as a path with its query — `/dashboard?tab=runs`.
 * @returns The path to navigate to, or `undefined` when the answer is to stay put.
 */
export function unauthenticatedDestination(status: number, from: string): string | undefined {
  if (status !== 401) return undefined;
  if (from.split(/[?#]/, 1)[0] === LOGIN_PATH) return undefined;

  return loginPath(from);
}

/**
 * The client the **browser** calls through.
 *
 * `better-auth/react` rather than `better-auth/client`: the hooks that entry point adds are
 * what keep one tab in step — a shared session store, a refetch when the window regains
 * focus, a broadcast to the other tabs after a sign-out. All of it is inert until something
 * subscribes, and all of it is meaningless on a server, which is why
 * `app/api/auth-server.ts` builds a plainer instance instead of importing this one.
 */
export const authClient = createAuthClient({
  baseURL: browserOrigin(),
  basePath: AUTH_BASE_PATH,
  plugins: [organizationClient()],
  fetchOptions: {
    // Resolved per call rather than captured once, so a suite that replaces `globalThis.fetch`
    // is answering the client it is testing. `customFetchImpl: fetch` would bind whichever
    // implementation existed when this module was first evaluated.
    customFetchImpl: (input, init) => fetch(input, init),
    onError: ({ response }) => {
      if (typeof window === "undefined") return;

      const destination = unauthenticatedDestination(
        response.status,
        `${window.location.pathname}${window.location.search}`,
      );

      if (destination !== undefined) window.location.assign(destination);
    },
  },
});

/**
 * The auth family, as a Client Component says it.
 *
 * ```tsx
 * "use client";
 * import { useSession, signOut } from "@/app/api/auth-client";
 *
 * const { data, isPending } = useSession();
 * ```
 *
 * `useSession()` is BetterAuth's own hook over the client's session store: it fetches once
 * on mount, shares one answer between every component that asks, and re-reads after a
 * sign-in or a sign-out anywhere in the tab. A Server Component reads the same session
 * through `readSession()` in `app/api/auth-server.ts` — the same routes, the same shapes,
 * with this request's cookies attached.
 *
 * **Prefer the server helper.** Everything shipped on `/login` is Server Components with
 * Server Action writes and `app/(auth)/login/page.tsx` documents why; a hook is the right
 * answer only where a component is already a Client Component for some other reason — the
 * account menu in the app shell ([#721](https://github.com/NobuData/ouroboros/issues/721))
 * being the case this is here for, and the case that took the export list below to its
 * present length.
 *
 * ### `useListOrganizations` is the plugin's own hook, and it is not `GET /api/v1/orgs`
 *
 * Two listings of the same workspaces exist and they answer different questions, so which one
 * a surface reads is a decision rather than a preference:
 *
 * | | `useListOrganizations()` | `GET /api/v1/orgs` (`app/api/tenants.ts`) |
 * |---|---|---|
 * | **Fields** | id, name, slug, logo | those **plus** roles, repository counts, the monogram, `personal` |
 * | **Where** | the browser, from a store `setActive` invalidates | the server, per render |
 * | **For** | *which workspace am I in, and what may I move to* | *what is in each of them* |
 *
 * The account menu asks the first question and nothing else — it names the active workspace
 * and offers the others — so it reads the plugin's listing, which is also the one that
 * refreshes itself the moment `organization.setActive` returns. The login screen's step 2
 * asks the second and reads the contract's ([#719](https://github.com/NobuData/ouroboros/issues/719)).
 * Neither is a fallback for the other.
 */
export const { useSession, useListOrganizations, getSession, signIn, signOut, organization } =
  authClient;
