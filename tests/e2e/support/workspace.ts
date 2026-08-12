/**
 * Putting a browser context straight into a workspace.
 *
 * `specs/sign-in.spec.ts` earns the active workspace the way a person does — it reads the
 * list, presses the row, and follows the redirect — because that flow *is* what that spec
 * asserts. Every other browser leg needs to be in a workspace without re-testing how one
 * gets there, and repeating a four-navigation flow in each of them would spend the suite's
 * ten-minute budget proving the same thing over and over.
 *
 * So this writes the cookie the flow would have written. It is not a shortcut past a
 * check: `app/api/access.ts` still resolves the reference against the memberships
 * `ouroboros-rest` reports for the session in that same request, so a cookie naming a
 * workspace this user does not belong to lands on the workspace chooser exactly as a
 * hand-edited one would. What is skipped is the clicking, not the authorisation.
 */

import type { BrowserContext } from "@playwright/test";

import { UI_URL } from "./stack";

/**
 * The cookie the login flow writes — `ouroboros-ui/app/api/tenant.ts`.
 *
 * Written down rather than imported: unlike the session token, this is a name and a plain
 * string value rather than a signed format, so there is nothing here that can silently
 * drift out of agreement. A renamed cookie fails this suite loudly at the first assertion
 * that expects a dashboard.
 */
export const ACTIVE_TENANT_COOKIE = "ouro_tenant";

/**
 * Make a workspace the active one for every page this context opens.
 *
 * @param context - The context to write the cookie into. It must already carry a session
 *   (`support/session.ts`) — a tenant cookie on its own authorises nothing and lands on
 *   the login screen.
 * @param slug - The workspace's slug, from `support/seed.ts`.
 */
export async function selectWorkspace(context: BrowserContext, slug: string): Promise<void> {
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
      // exactly like a workspace that was never chosen.
      secure: false,
      sameSite: "Lax",
    },
  ]);
}
