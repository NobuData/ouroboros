/**
 * How this suite arrives signed in — and why that is a credential rather than a bypass.
 *
 * ## The problem
 *
 * Issue [#56](https://github.com/NobuData/ouroboros/issues/56) asks for a *dev-auth login*
 * leg. The stack it must run against will not serve one. `ouroboros-rest`'s image pins
 * `NODE_ENV=production` (`ouroboros-rest/Dockerfile`), and production is where
 * `loadConfiguration` *deletes* `OURO_AUTH_DEV_USER` before the schema ever sees it — the
 * acceptance criterion of [#33](https://github.com/NobuData/ouroboros/issues/33), and
 * documented in `README.md` § Signing in as the reason sign-in in the compose stack is the
 * real GitHub handshake. Nor can that be turned off from the outside: `listenHost()` reads
 * the same variable, so a container told `NODE_ENV=development` binds `127.0.0.1` *inside
 * itself* and the published port goes dead.
 *
 * The real handshake is not scriptable either. It is a redirect to github.com, a human
 * consenting, and a callback — none of which a nightly job can perform, and the BetterAuth
 * flow `docs/ROADMAP_OOE_MVP.md` amends this issue to require does not exist yet: its
 * blocker `D.5` is one of the 22 issues that roadmap flags as unfiled.
 *
 * ## What this does instead
 *
 * It mints a session the way the service mints one, and hands it to the browser.
 *
 * `issueSession()` below is not a re-implementation — it is `ouroboros-rest`'s own
 * function, imported. The cookie it returns is signed with `OURO_SESSION_SECRET`, the same
 * key the running container holds, so the request that carries it goes through the entire
 * ordinary path: `auth.guard.ts` reads the header, `readToken` verifies the HMAC in
 * constant time, checks the `iat` against the maximum age, and the service then *reads the
 * user row from the database* before anything is authorised. Nothing is stubbed and no
 * check is skipped. A deleted user, a rotated secret or an expired token all fail here
 * exactly as they fail for a person.
 *
 * The distinction worth holding on to: a bypass is code in the product that makes the
 * service trust an unauthenticated request. This is a test holding a legitimately signed
 * credential. The product is byte-for-byte the image that ships, and turning this suite
 * off changes nothing about it.
 *
 * ## Why the import rather than a local HMAC
 *
 * Because a copy would drift. If the token format changed — a field added, the separator
 * moved, the payload encoded differently — a local implementation would keep producing
 * yesterday's cookie, and this suite would report an authentication failure that has
 * nothing to do with authentication. Importing means the format has one definition, and
 * `yarn typecheck` here fails the moment its signature changes.
 *
 * It is the *only* import from a service's source in this directory, and
 * `eslint.config.mjs` enforces that — every other module in the suite reaches a service
 * over HTTP, which is what makes it an end-to-end test at all.
 *
 * ## What replaces this
 *
 * One function. When the BetterAuth work lands, `signedInContext()` becomes a call to
 * whatever that flow's test helper is, and no spec changes — none of them know how the
 * cookie got there.
 */

import type { BrowserContext, Cookie } from "@playwright/test";

// The two files that define the credential format. See this module's header for the rule
// that permits these two imports and forbids every other one.
import {
  SESSION_COOKIE,
  SESSION_COOKIE_PATH,
  issueSession,
} from "../../../ouroboros-rest/src/modules/auth/session";

import { REST_URL, SESSION_SECRET, UI_URL } from "./stack";

/** What a signed-in caller carries, in the two forms the suite needs it in. */
export interface SignedIn {
  /** The raw token, for a scripted request's own `Cookie` header. */
  readonly token: string;
  /** The cookies to seed a browser context with — one per origin; see below. */
  readonly cookies: readonly Cookie[];
}

/**
 * Mint a session for a seeded user.
 *
 * @param userId - `ouroboros.users.id`. Must name a row the seed created, because the
 *   guard reads the row: a signature over a user that does not exist authenticates
 *   nobody, which is the property `auth.service.ts` calls out.
 * @param now - When the session is issued. Defaults to now; a test that wants an expired
 *   token passes a date a week back, which is how `specs/sign-in.spec.ts` proves the
 *   session is actually checked rather than merely present.
 * @returns The token and the cookies that carry it.
 */
export function mintSession(userId: string, now: Date = new Date()): SignedIn {
  const token = issueSession(userId, SESSION_SECRET, now);

  return { token, cookies: sessionCookies(token) };
}

/**
 * The session cookie, once per origin the browser will send it to.
 *
 * Two origins, and the reason is the compose stack's shared network namespace: the UI is
 * published on `localhost:3000` and `ouroboros-rest` on `localhost:4000`. A cookie is
 * scoped to a host *and a port is not part of that scope*, so one entry would in principle
 * cover both — but Playwright's `addCookies` takes either a `url` or an explicit
 * `domain`/`path` pair, and giving it both urls states the intent plainly rather than
 * relying on how a cookie jar happens to key its entries.
 *
 * `httpOnly` matches what the service sets (`sessionCookieAttributes`), so the page cannot
 * read it through `document.cookie` here either — a suite whose session is visible to
 * script would be quietly testing a weaker cookie than the one that ships.
 *
 * `secure` is `false`, and that is not a relaxation: the attribute means *never over plain
 * HTTP*, this stack is plain HTTP on loopback, and a `Secure` cookie the browser declined
 * to send would look exactly like a broken session.
 *
 * @param token - The signed token.
 * @returns One cookie per origin, ready for `BrowserContext.addCookies`.
 */
function sessionCookies(token: string): Cookie[] {
  return [UI_URL, REST_URL].map((origin) => {
    const { hostname } = new URL(origin);

    return {
      name: SESSION_COOKIE,
      value: token,
      domain: hostname,
      path: SESSION_COOKIE_PATH,
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
    };
  });
}

/**
 * Sign a browser context in as a seeded user.
 *
 * @param context - The context to add the cookies to. Every page opened from it afterwards
 *   carries the session; pages already open do too, on their next request.
 * @param userId - Whose session, from `support/seed.ts`.
 * @returns The credential, for a spec that also wants to make a scripted call as the same
 *   person.
 */
export async function signIn(context: BrowserContext, userId: string): Promise<SignedIn> {
  const session = mintSession(userId);

  await context.addCookies([...session.cookies]);

  return session;
}
