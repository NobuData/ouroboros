/**
 * Putting a browser context straight into a workspace.
 *
 * `specs/sign-in.spec.ts` earns the active workspace the way a person does — it reads the
 * list, picks a row and presses **Enter mission control →** — because that flow *is* what
 * that spec asserts. Every other browser leg needs to be in a workspace without re-testing
 * how one gets there, and repeating a three-navigation flow in each of them would spend the
 * suite's ten-minute budget proving the same thing over and over.
 *
 * ## What this had to become
 *
 * It wrote a cookie. `ouro_tenant` named the active workspace until
 * [#719](https://github.com/NobuData/ouroboros/issues/719), so a cookie in the jar was the
 * whole of "this browser is in that workspace" — and the leg that skipped the clicking
 * skipped nothing else, because `app/api/access.ts` still resolved the value against the
 * memberships the service reported.
 *
 * The workspace is **server state** now: `session."activeOrganizationId"`, written by
 * `POST /api/auth/organization/set-active` and by nothing else, which is exactly what makes
 * the cookie no longer worth writing on its own. So this calls the route the CTA calls, with
 * the session the context already carries. It is still not a shortcut past a check — the
 * service answers `403` for an organization the caller is not a member of, and the pointer is
 * cleared on the way out, so a slug this user does not belong to leaves the browser on the
 * login screen exactly as pressing the button would have.
 *
 * The cookie is still written beside it, because it is still read: it is what tells
 * `/login` this browser has already been asked where the loop runs
 * (`ouroboros-ui/app/api/server.ts`), and without it a leg navigating to `/login` would be
 * asked again. Only its *presence* is read — the UI writes the workspace's id there and this
 * writes the slug it was given, and neither is consulted.
 */

import type { BrowserContext } from "@playwright/test";

import { AUTH_BASE_PATH, SESSION_COOKIE, sessionTokenOf } from "./session";
import { REST_URL, UI_URL } from "./stack";

/**
 * The cookie the login flow writes — `ouroboros-ui/app/api/tenant.ts`.
 *
 * Written down rather than imported: unlike the session token, this is a name and a plain
 * string value rather than a signed format, so there is nothing here that can silently
 * drift out of agreement. A renamed cookie fails this suite loudly at the first assertion
 * that expects a dashboard.
 *
 * **It authorises nothing.** See this module's header, and `ouroboros-ui/app/api/server.ts`
 * for what is left of it.
 */
export const ACTIVE_TENANT_COOKIE = "ouro_tenant";

/**
 * Make a workspace the one this context's session is acting in.
 *
 * @param context - The context to act for. It must already carry a session
 *   (`support/session.ts`) — there is nothing for this to write the pointer onto otherwise.
 * @param slug - The workspace's slug, from `support/seed.ts`.
 * @returns When the session is acting in that workspace and the browser knows it has been
 *   asked.
 * @throws {Error} If the context carries no session, or if the service refused the switch —
 *   with the status and the body it answered. A silent failure here would surface as a
 *   dashboard heading that is not there, in another file.
 */
export async function selectWorkspace(context: BrowserContext, slug: string): Promise<void> {
  const token = await sessionTokenOf(context, `selectWorkspace(${slug})`);

  const response = await fetch(`${REST_URL}${AUTH_BASE_PATH}/organization/set-active`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${token}`,
    },
    body: JSON.stringify({ organizationSlug: slug }),
  });

  if (!response.ok) {
    throw new Error(`set-active for ${slug} answered ${response.status}: ${await response.text()}`);
  }

  await context.addCookies([
    {
      name: ACTIVE_TENANT_COOKIE,
      value: slug,
      domain: new URL(UI_URL).hostname,
      path: "/",
      expires: -1,
      httpOnly: true,
      // The UI image runs in production and therefore sets this `Secure`. It is written
      // here without the attribute for the same reason `support/session.ts` is: the stack
      // is plain HTTP on loopback, and a cookie the browser declined to send would look
      // exactly like a browser that had never been through step 2.
      secure: false,
      sameSite: "Lax",
    },
  ]);
}
