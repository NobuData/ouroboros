/**
 * How long a session lasts, when it is renewed, and how often the server is asked about it
 * ([#703](https://github.com/NobuData/ouroboros/issues/703)).
 *
 * Four numbers and the cookies they govern, in their own module rather than inline in
 * `auth.options.ts`, because they are the part of the auth configuration that is a
 * *security* decision rather than a wiring one: `docs/ARCHITECTURE.md` § 4.1.1 publishes
 * them, `ouroboros-ui` reasons about them, and roadmap decision **A6** is the argument for
 * the mechanism they configure. A number with a reason beside it is worth a file; the same
 * number buried in an object literal is a magic constant somebody will "tidy".
 *
 * ## What changed, and what it costs
 *
 * [#33](https://github.com/NobuData/ouroboros/issues/33) issued a **stateless** signed
 * cookie: no `sessions` table, nothing to evict, and — the price it wrote down itself — no
 * revocation. A copy taken before sign-out stayed valid for the remainder of its seven
 * days, because nothing on the server knew it had ever been handed out.
 *
 * These options replace that with a row in `ouroboros.session`
 * ([#706](https://github.com/NobuData/ouroboros/issues/706)). Signing out deletes the row,
 * so the next request carrying that cookie resolves to nothing — revocation is immediate
 * and is a `delete`, not an expiry. What that costs is a lookup per request, and
 * {@link SESSION_COOKIE_CACHE_SECONDS} is the answer to it.
 *
 * @see auth.options.ts — where {@link sessionOptions} is handed to the library.
 * @see ../modules/auth/legacy.cookie.ts — the eviction of the cookie this replaces.
 */

import type { BetterAuthOptions } from "better-auth";

/**
 * How long a session is good for, in seconds — **seven days**.
 *
 * Deliberately the same lifetime #33 chose, so that retiring the stateless cookie changes
 * *revocability* and nothing else: a change of mechanism and a change of policy landing
 * together would leave nobody able to say which one caused the support ticket. Long enough
 * that somebody working through a week is not signed out mid-task, and no longer than that
 * — it is still the bound on a cookie stolen from a machine nobody signs out of.
 *
 * It is a constant rather than a configurable, for the reason #33 gave and this issue does
 * not repeal: a security property with an environment variable in front of it is a
 * security property somebody sets to a year when re-authenticating gets annoying.
 */
export const SESSION_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;

/**
 * How old a session must be before using it extends it, in seconds — **one day**.
 *
 * BetterAuth slides the expiry: a request made when the session is within
 * `expiresIn - updateAge` of issue rewrites `expiresAt` and re-sets the cookie, so somebody
 * who uses Ouroboros daily is never signed out and somebody who stops is signed out a week
 * later. The number is what stops that renewal happening on *every* request — which would
 * be an `update` against `session` per request, and the exact cost the cookie cache below
 * exists to avoid.
 *
 * It happens to be the library's own default, and it is stated anyway — a value this
 * service depends on should not be able to change under it in an upgrade.
 */
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

/**
 * How long the signed session snapshot in the cookie is trusted, in seconds — **five
 * minutes**.
 *
 * This is the acceptance criterion *session lookup adds ≤ 1 DB query per request*. With it
 * on, BetterAuth writes a second cookie holding the session and the user, signed with
 * `BETTER_AUTH_SECRET`; while that snapshot is fresh, `getSession` answers from it and
 * issues **no statement at all**. When it is stale, one lookup against `session` joined to
 * `"user"` refreshes both the answer and the snapshot.
 *
 * Five minutes is the library's default and it is the right trade rather than merely the
 * one that arrived: the window is exactly how long a revoked session can still be honoured
 * by a browser that already held a fresh snapshot, so it is short enough that "signed out"
 * means signed out to anybody watching, and long enough that a page load making a dozen
 * calls costs one query rather than a dozen.
 *
 * **It does not weaken sign-out for the browser that signed out.** That request clears both
 * cookies. The window applies to a *copied* cookie, which is the case #38 was opened for —
 * and five minutes is a bound the stateless cookie could not offer at all.
 */
export const SESSION_COOKIE_CACHE_SECONDS = 5 * 60;

/**
 * The cookie BetterAuth carries the session token in.
 *
 * The library's default, composed from its default `cookiePrefix` — restated here because
 * it is a value three other things have to agree with: `openapi.yaml`'s `ouroSession`
 * security scheme, `ouroboros-ui`'s client, and anybody debugging a browser's cookie jar.
 * Renaming it with `advanced.cookiePrefix` was considered and rejected: the prefix is what
 * every BetterAuth answer on the internet assumes, and the `ouro_` convention buys nothing
 * in a jar where the only other Ouroboros cookie is this one's cache.
 *
 * **In production it is `__Secure-better-auth.session_token`.** The library adds the
 * prefix itself when `baseURL` is `https://`, and a browser refuses a `__Secure-` cookie
 * that did not arrive over TLS — which is the same protection #33 spelled `Secure`, made
 * un-droppable by being part of the name.
 */
export const SESSION_COOKIE = "better-auth.session_token";

/**
 * The cookie holding the cached session snapshot — see {@link SESSION_COOKIE_CACHE_SECONDS}.
 *
 * Named for the same reason as {@link SESSION_COOKIE}: it is the second cookie a browser
 * ends up holding, and somebody looking at two where they expected one should find the
 * answer by grepping the name. It carries a signed copy of the session and the user, so it
 * is `HttpOnly` like the token, and it takes the same `__Secure-` prefix in production.
 */
export const SESSION_DATA_COOKIE = "better-auth.session_data";

/**
 * The session block of BetterAuth's options.
 *
 * A function returning a fresh object rather than a shared literal, matching
 * `authOptions`: the caller owns what it is given, and a shared object is a caller's
 * mutation reaching another caller's instance.
 *
 * @returns The lifetime, the renewal threshold and the cookie cache, as the library takes
 *   them. Every value is stated rather than defaulted — see each constant for why.
 */
export function sessionOptions(): BetterAuthOptions["session"] {
  return {
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
    cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_SECONDS },
  };
}
