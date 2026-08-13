"use server";

/**
 * What the app shell submits — which is one thing: signing out.
 *
 * **This module is the wrapper `app/api/auth-server.ts` deliberately did not write.**
 * [#716](https://github.com/NobuData/ouroboros/issues/716) landed `signOutSession()` and left
 * it unexported to the browser, because "a Server Action nothing submits to is a POST endpoint
 * published for nobody" — the form belongs with the menu that draws it, and that menu is this
 * issue's. So the seam is opened here, once, beside its only caller.
 *
 * ### Why signing out is a Server Action and switching workspace is not
 *
 * They are the two writes the account menu makes and they go opposite ways, which looks
 * inconsistent until you ask what each one has to *change*:
 *
 * | | Sign out | Switch workspace |
 * |---|---|---|
 * | Changes | the session row, **two `HttpOnly` cookies, and `ouro_tenant`** | `session."activeOrganizationId"` |
 * | Reached through | this action | `organization.setActive`, from the browser |
 * | Why | script cannot delete an `HttpOnly` cookie, and `ouro_tenant` is this application's own | the browser's own call is what receives BetterAuth's refreshed `session_data` cookie, and what invalidates the client's session store |
 *
 * The second row is the whole argument. A cookie the *server* is handed cannot be written by
 * the browser, and a cookie the *browser* is handed cannot be written by the server — which
 * `app/api/auth-server.ts` records as the reason it deletes the auth cookies by hand rather
 * than leaving them to the service's own `Set-Cookie`.
 *
 * ### There is no authority to re-derive here
 *
 * Every other action in this module family opens with a paragraph about a Server Action being
 * a POST endpoint anybody can reach (`app/login/actions.ts`), and it is just as true of this
 * one — but the thing it acts on is *the caller's own request cookies*. There is no reference
 * to resolve and nothing to name that would make it act on somebody else: a request carrying
 * no session signs nobody out, and a request carrying one signs out exactly the person it
 * belongs to. The check that would be written here is the one the transport already is.
 */

import { signOutSession } from "@/app/api/auth-server";

/**
 * Sign out, and land on the login screen.
 *
 * Everything it does is `signOutSession()`'s — revoke the session row, delete both auth
 * cookies from this response, forget the step-2 hint, and redirect — so this is the boundary
 * and not a second copy of the rules.
 *
 * It takes no arguments even though React hands a form action its `FormData`: there is
 * nothing a sign-out form could say that would change what happens, and a parameter read by
 * nobody is a field somebody will eventually try to put something in.
 *
 * @throws Next.js's redirect signal, always — to `/login`, with no return-to, since the page
 *   being left is one this browser may no longer see.
 */
export async function signOutOfSession(): Promise<void> {
  await signOutSession();
}
