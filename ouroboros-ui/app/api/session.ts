/**
 * The session resource — who is signed in, and where sign-in begins.
 *
 * `GET /api/v1/auth/me` is one call rather than three: the person for the profile menu,
 * the workspaces they belong to for the switcher, and — for somebody who belongs to none
 * — the workspace their email domain points at. `app/api/access.ts` is what reads it on
 * behalf of a screen; this file is only the vocabulary over the generated client, in the
 * shape `app/api/tenants.ts` established. What a membership *means* — which one a
 * reference resolves to, and who may change a workspace — is `app/api/membership.ts`,
 * which is framework-free so that both this and the screens can read the same rules.
 *
 * Sign-in itself is **not** a call through this client, which is why
 * {@link githubSignInUrl} returns a URL rather than doing anything: a `fetch` would follow
 * a redirect to github.com into a page it cannot render and land nobody anywhere.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";
import { restUrl } from "@/app/env";

/** Who is signed in, the workspaces they belong to, and a suggestion when they have none. */
export type Session = components["schemas"]["Session"];

/** The signed-in person: id, address, display name and avatar. */
export type SessionUser = components["schemas"]["SessionUser"];

/** A workspace whose registered email domain matches the person's address. Not membership. */
export type TenantSuggestion = components["schemas"]["TenantSuggestion"];

/**
 * Where signing in with GitHub begins.
 *
 * **BetterAuth's**, since [#702](https://github.com/NobuData/ouroboros/issues/702) retired
 * the hand-rolled flow `GET /api/v1/auth/github` served. It is deliberately *not* typed
 * against `keyof paths`, as its predecessor was: the library serves its own routes on the
 * HTTP adapter ahead of Nest's router, so they are not in `openapi.yaml` and cannot be
 * until [#711](https://github.com/NobuData/ouroboros/issues/711) publishes them. The
 * generated types stop being able to check this string in the meantime, and pretending
 * otherwise by pointing the annotation at some other path would be worse than saying so.
 */
const GITHUB_SIGN_IN_PATH = "/api/auth/sign-in/social";

/**
 * The absolute URL of "Continue with GitHub".
 *
 * This is the one address of `ouroboros-rest` that legitimately reaches the browser, and
 * it reaches it as an `href` in server-rendered HTML rather than as configuration: the
 * OAuth handshake is a navigation a person follows, so the URL has to be one their browser
 * can resolve. `OURO_REST_URL` still carries no `NEXT_PUBLIC_` prefix and is still absent
 * from the client bundle — nothing in the browser can *compose* a call to the service,
 * which is the property that mattered.
 *
 * **It is not yet a working link, and that is #702's known cost.** BetterAuth begins a
 * social sign-in with a `POST` carrying `{ provider: "github" }` and answers with the
 * github.com URL for the caller to follow — so a person clicking an anchor at this address
 * gets a `404` rather than a consent screen.
 * [#718](https://github.com/NobuData/ouroboros/issues/718) is the issue that replaces the
 * anchor with `authClient.signIn.social`, and it is the reason this function still exists
 * rather than having been deleted with the route: the login screen, its props and its
 * suites are all built around a URL, and re-pointing all of that is #718's work rather than
 * something to do halfway here.
 *
 * @returns The sign-in URL, absolute.
 * @throws {Error} From {@link restUrl}, when `OURO_REST_URL` is unset or unusable.
 */
export function githubSignInUrl(): string {
  return `${restUrl()}${GITHUB_SIGN_IN_PATH}`;
}

/**
 * The current session.
 *
 * One method, because the contract has one: everything a screen wants to know about who
 * is signed in arrives in a single response.
 */
export const session = {
  /**
   * Who is signed in, and what they belong to.
   *
   * @param client The client to call through. Defaults to the server-side one, whose
   *   `401` handling redirects to the login screen — which is why the login screen itself
   *   passes `anonymousApi()` instead. See {@link file://./access.ts}.
   * @returns The session.
   * @throws {ApiError} What the service answered. A `401` means no session: absent,
   *   expired, forged, or naming a person who has been deleted — the contract does not
   *   distinguish them, and a client could not act differently on any of them.
   */
  async read(client: ApiClient = api()): Promise<Session> {
    return unwrap(await client.GET("/api/v1/auth/me", {}));
  },
};
