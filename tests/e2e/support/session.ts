/**
 * How this suite arrives signed in — one call to the development sign-in route.
 *
 * ## What this used to be, twice
 *
 * Issue [#56](https://github.com/NobuData/ouroboros/issues/56) asks for a *dev-auth login*
 * leg. It has now had three answers. #33's was a bypass — one environment variable naming an
 * address that the guard treated as already signed in; the stack would not serve it, because
 * `ouroboros-rest`'s image pins `NODE_ENV=production` and production dropped the variable
 * before the schema saw it — so this module minted a session itself, with `issueSession()`
 * imported from `ouroboros-rest`'s own source and signed with the running container's key.
 * [#703](https://github.com/NobuData/ouroboros/issues/703) retired that session: there is no
 * signing key any more, because a session is a **row** in `ouroboros.session` and a cookie
 * merely names it. Nothing about a row is reproducible from outside the stack, so the legs
 * that need one were parked.
 *
 * [#705](https://github.com/NobuData/ouroboros/issues/705) is the third answer and the one
 * below: BetterAuth's email/password sign-in, enabled wherever `NODE_ENV` is not
 * `production`. {@link signIn} is an ordinary HTTP call to a real route, exchanging a real
 * credential for a real session row — which is what this directory's rule has always asked
 * for, and what neither of the previous two could offer. Nothing reaches into PostgreSQL and
 * nothing imports from a service; `eslint.config.mjs` enforces the second half of that, and
 * the exception it used to permit is gone for good.
 *
 * ## Why the legs are still parked
 *
 * Two things, and both are outside #705:
 *
 *   * **[#709](https://github.com/NobuData/ouroboros/issues/709)** — the development seed
 *     does not yet write BetterAuth's `"user"` and `account` rows, so there is no seeded
 *     credential for {@link signIn} to present. {@link SEED_PASSWORD} is the value that
 *     issue has to seed.
 *   * **The stack runs the production image.** `docker compose` starts `ouroboros-rest`
 *     from a Dockerfile that pins `NODE_ENV=production`, and that is the single flag #705
 *     gates the password routes on — so against this stack, the route below answers 400
 *     `EMAIL_PASSWORD_DISABLED` by design. Overriding the variable in compose does not fix
 *     it: the same value moves the service's listen address back to loopback, and a
 *     container bound to loopback publishes nothing. Serving the development sign-in to
 *     this suite therefore needs a stack change — a non-production `rest` that still binds
 *     every interface — which is a decision for #56 or #715 rather than something #705 can
 *     make on their behalf.
 *
 * So the signed-in legs keep `test.fixme` and {@link SESSION_PARKED} as the reason, and say
 * so in the run's report rather than failing every night at three. **Every leg that does not
 * need a session still runs**, which is most of the health, shell and negative-path
 * coverage — including, importantly, the assertions that a stranger is refused.
 *
 * When both are resolved, the change here is deleting {@link SESSION_PARKED} and the
 * `test.fixme` lines that name it. {@link signIn} itself is finished: no spec knows how the
 * cookie got there.
 */

import type { BrowserContext } from "@playwright/test";

import { SEED_PASSWORD, seededUser } from "./seed";
import { REST_URL, UI_URL } from "./stack";

/**
 * Why the signed-in legs do not run, in the words a report should carry.
 *
 * A constant rather than a string per call site, so that the day it stops being true there
 * is one place to delete and `grep` finds every leg that was waiting on it.
 */
export const SESSION_PARKED =
  "Signing in needs #709 (the seed writes BetterAuth's user and account rows, with the " +
  "passwords support/seed.ts names) and a stack whose ouroboros-rest is not NODE_ENV=" +
  "production — the image pins it, and #705 gates the development password routes on " +
  "exactly that flag. signIn() below is the real call and is ready for both.";

/**
 * The cookie a signed-in browser carries.
 *
 * BetterAuth's default name, restated here because it is a value this suite has to agree
 * with `ouroboros-rest`'s `src/auth/session.options.ts` about. The specs that assert a
 * session is *checked* still set one by hand — a value naming no row, which is the post-#703
 * form of "a forged credential authenticates nobody". Those legs need no sign-in and do run.
 */
export const SESSION_COOKIE = "better-auth.session_token";

/** Where BetterAuth's own routes are mounted — `ouroboros-rest`'s `AUTH_BASE_PATH`. */
export const AUTH_BASE_PATH = "/api/auth";

/**
 * Exchange a seeded person's credentials for a session, and give it to a browser.
 *
 * The whole of how this suite signs in. It calls the same route `ouroboros-ui`'s sign-in
 * form calls, over HTTP, from outside the stack — so what it proves when a leg using it
 * passes is that the real route, the real hash comparison and the real session row all work,
 * rather than that this file can construct a cookie.
 *
 * @param context - The browser context to sign in. Its cookie jar is what receives the
 *   session; the page opened from it afterwards is signed in.
 * @param userId - Whose session, as `support/seed.ts` names them. An id rather than an
 *   address because that is what the specs already pass and what the seed keys on.
 * @returns When the context carries the session cookie.
 * @throws {Error} If the route refuses the credentials, with the status and the body it
 *   answered. A sign-in that fails silently would surface as a heading that is not there,
 *   three assertions later and in another file.
 */
export async function signIn(context: BrowserContext, userId: string): Promise<void> {
  const { token } = await mintSession(userId);

  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: token,
      // The *UI's* host, not the API's: the cookie has to travel with the page navigations
      // the specs make, and those go to ouroboros-ui. Both are localhost in every stack this
      // suite runs against, which is what makes one cookie work for two ports — a browser's
      // cookie jar is keyed by host and ignores the port.
      domain: new URL(UI_URL).hostname,
      path: "/",
      expires: -1,
      httpOnly: true,
      // The stack is plain HTTP on localhost. A `Secure` cookie would be dropped by the
      // browser and the leg would fail as though the session had never been granted.
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

/** What {@link mintSession} hands back. */
export interface MintedSession {
  /**
   * The session token — the cookie's value, with BetterAuth's `token.signature` suffix left
   * on it, because that is what the service issued and what it verifies.
   */
  readonly token: string;
}

/**
 * Sign in over HTTP and return the session the service issued.
 *
 * Separate from {@link signIn} because two callers want different halves of it: a browser
 * leg wants the cookie in a jar, and an API leg wants the token to send as a header
 * (`support/api.ts`'s `asUser`). Neither wants to know that the route is
 * `POST /api/auth/sign-in/email`.
 *
 * An object rather than a bare string, which is the shape the API legs already destructure
 * and leaves somewhere for the session's other fields to go when a leg needs one.
 *
 * @param userId - Whose session, as `support/seed.ts` names them.
 * @returns The minted session.
 * @throws {Error} If the person is not one the seed defines, or if the route refuses.
 */
export async function mintSession(userId: string): Promise<MintedSession> {
  const person = seededUser(userId);

  const response = await fetch(`${REST_URL}${AUTH_BASE_PATH}/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: person.email, password: SEED_PASSWORD }),
  });

  if (!response.ok) {
    // The body is included because the two failures worth telling apart both answer 400:
    // `EMAIL_PASSWORD_DISABLED` means the stack is running the production image, and
    // `INVALID_EMAIL_OR_PASSWORD` means the seed has not written the credential. See this
    // module's header on both.
    throw new Error(
      `sign-in for ${person.email} answered ${response.status}: ${await response.text()}`,
    );
  }

  const token = sessionTokenFrom(response);

  if (token === undefined) {
    throw new Error(
      `sign-in for ${person.email} succeeded but set no ${SESSION_COOKIE} cookie — ` +
        "the service answered 200 without issuing a session",
    );
  }

  return { token };
}

/**
 * Pull the session token out of a response's `Set-Cookie` headers.
 *
 * @param response - What the sign-in route answered.
 * @returns The token, or `undefined` when no session cookie was set. `getSetCookie` is used
 *   rather than `get("set-cookie")` because the route sets more than one cookie and the
 *   single-header form joins them with a comma — which is ambiguous, since a cookie's
 *   `Expires` attribute contains one.
 */
function sessionTokenFrom(response: Response): string | undefined {
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";");
    const separator = pair.indexOf("=");

    if (separator !== -1 && pair.slice(0, separator).trim() === SESSION_COOKIE) {
      const value = decodeURIComponent(pair.slice(separator + 1).trim());
      return value === "" ? undefined : value;
    }
  }

  return undefined;
}
