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
 * Sign-in itself is **not** a call, which is why {@link githubSignInUrl} returns a URL
 * rather than doing anything: the contract says so in as many words
 * (`ouroboros-rest/openapi.yaml` § `startGithubSignIn`), because a `fetch` would follow a
 * `302` to github.com into a page it cannot render and land nobody anywhere. The login
 * screen renders it as a link and the browser navigates.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components, paths } from "@/app/api/schema";
import { api } from "@/app/api/server";
import { restUrl } from "@/app/env";

/** Who is signed in, the workspaces they belong to, and a suggestion when they have none. */
export type Session = components["schemas"]["Session"];

/** The signed-in person: id, address, display name and avatar. */
export type SessionUser = components["schemas"]["SessionUser"];

/** A workspace whose registered email domain matches the person's address. Not membership. */
export type TenantSuggestion = components["schemas"]["TenantSuggestion"];

/**
 * Where a browser is sent to begin signing in with GitHub.
 *
 * Typed as a path the contract describes — a rename in `openapi.yaml` is a failed
 * typecheck here after `yarn api:sync` rather than a link that 404s in a browser.
 */
const GITHUB_SIGN_IN_PATH: keyof paths = "/api/v1/auth/github";

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
