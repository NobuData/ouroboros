/**
 * The session — what a browser carries between sign-in and sign-out.
 *
 * A signed cookie holding a user id and the moment it was issued, and nothing else. The
 * issue calls it *a stateless signed cookie for MVP*, and the two words are the whole
 * design:
 *
 *   * **Signed**, so the id in it is one this service put there — see `signing.ts`.
 *   * **Stateless**, so there is no `sessions` table, no store to run and nothing to
 *     evict. What it costs is revocation: a cookie copied before sign-out stays valid
 *     until {@link SESSION_MAX_AGE_SECONDS} passes, because nothing on the server knows it
 *     was ever handed out. That is why the lifetime is a week rather than a year, and the
 *     revocable design is recorded with
 *     [#38](https://github.com/NobuData/ouroboros/issues/38).
 *
 * The payload is an id, not a copy of the user. A cookie carrying an email and a display
 * name is a cache with no invalidation: rename yourself and the header keeps saying what
 * you were called at sign-in, and a membership that was revoked keeps being honoured. The
 * guard reads the row on every request instead (`auth.guard.ts`), which costs one indexed
 * lookup and buys "deleted user, no access" for free.
 *
 * ---
 *
 * **Nothing issues one of these any more.**
 * [#702](https://github.com/NobuData/ouroboros/issues/702) moved sign-in to BetterAuth,
 * which mints its own session against the `session` table
 * ([#706](https://github.com/NobuData/ouroboros/issues/706)) — so
 * {@link issueSession}'s only caller went with `completeSignIn`, and this module is now
 * half a mechanism: `readSession` is still what `SessionGuard` authenticates every request
 * with, and `issueSession` is what nothing calls.
 *
 * That is the seam both issues warn about, and it is deliberately not patched over here.
 * [#703](https://github.com/NobuData/ouroboros/issues/703) deletes this file — along with
 * `signing.ts` and `cookies.ts` — and replaces the guard with the library's, and the two
 * are meant to land close together for exactly this reason. Reissuing an `ouro_session`
 * cookie from a BetterAuth session in the meantime would be a *third* session mechanism
 * built to be deleted a week later.
 */

import { epochSeconds, readToken, signToken, type Issued, type TokenTerms } from "./signing";
import type { CookieAttributes } from "./cookies";

/**
 * The cookie's name.
 *
 * `ouro_` prefixed, matching the `OURO_` convention every other name in this system
 * carries, so a browser's cookie jar says which application a cookie belongs to.
 */
export const SESSION_COOKIE = "ouro_session";

/**
 * How long a session lasts, in seconds — seven days.
 *
 * Long enough that a person working through a week is not signed out mid-task, short
 * enough to be the *only* bound on a stolen cookie, which for a stateless session it is.
 * The number is here rather than configurable on purpose: it is a security property, and a
 * variable is a place for it to be set to a year by whoever finds re-authenticating
 * annoying.
 */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** The path the session cookie is sent for: everything this service serves. */
export const SESSION_COOKIE_PATH = "/";

/** What the session cookie carries. */
export interface SessionPayload extends Issued {
  /** The user's id — `ouroboros.users.id`. Named `sub` after the JWT claim it is. */
  sub: string;
}

/**
 * Is this decoded payload a session?
 *
 * @param payload - A payload whose signature and `iat` have already been checked.
 * @returns Whether it carries a non-empty `sub`. This is what stops the OAuth handshake
 *   cookie — signed with the same key, and so carrying a real signature — from being
 *   accepted as a session.
 */
export function isSessionPayload(payload: Issued): payload is SessionPayload {
  return (
    "sub" in payload && typeof (payload as SessionPayload).sub === "string" && payload.sub !== ""
  );
}

/**
 * Sign a session for a user.
 *
 * @param userId - Whose session. `ouroboros.users.id`.
 * @param secret - `OURO_SESSION_SECRET`.
 * @param now - When it is being issued.
 * @returns The token to put in the cookie.
 */
export function issueSession(userId: string, secret: string, now: Date): string {
  return signToken({ sub: userId, iat: epochSeconds(now) } satisfies SessionPayload, secret);
}

/**
 * Read a session cookie.
 *
 * @param token - The cookie's value, or `undefined` when it was not sent.
 * @param terms - The secret and the instant to age it against. `maxAgeSeconds` defaults to
 *   {@link SESSION_MAX_AGE_SECONDS}; a caller that overrides it is a test.
 * @returns The payload, or `undefined` for every way a session can fail to be one.
 */
export function readSession(
  token: string | undefined,
  terms: Omit<TokenTerms, "maxAgeSeconds"> & Partial<Pick<TokenTerms, "maxAgeSeconds">>,
): SessionPayload | undefined {
  return readToken(token, { maxAgeSeconds: SESSION_MAX_AGE_SECONDS, ...terms }, isSessionPayload);
}

/**
 * The attributes the session cookie is set with.
 *
 * Every one of them is a decision the issue names:
 *
 *   * **`HttpOnly`** — script cannot read it, so a cross-site scripting bug in
 *     `ouroboros-ui` cannot exfiltrate a session. This is the single most valuable
 *     attribute here and it is not conditional on anything.
 *   * **`SameSite=Lax`** — the cookie rides top-level navigations, which is what the
 *     GitHub callback *is*, and is withheld from cross-site sub-requests, which is what
 *     CSRF is made of. `Strict` would break the callback: a browser arriving from
 *     github.com would not send the handshake cookie, and sign-in would fail on the last
 *     hop. `None` would put it on every cross-site request there is.
 *   * **`Secure` outside development** — the attribute means "never over plain HTTP", and
 *     development *is* plain HTTP on loopback, where a cookie that refused to travel would
 *     mean nothing worked locally. It is not a preference: it is on wherever the transport
 *     is not already the loopback interface.
 *   * **`Path=/`** — every route this service serves, including the probes, so a cookie
 *     does not silently stop being sent when a route moves.
 *
 * @param isProduction - Whether this is a production deployment, from `AppConfigService`.
 * @param maxAgeSeconds - Lifetime. Defaults to {@link SESSION_MAX_AGE_SECONDS}.
 * @returns The attributes for {@link serializeCookie}.
 */
export function sessionCookieAttributes(
  isProduction: boolean,
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS,
): CookieAttributes {
  return {
    maxAgeSeconds,
    path: SESSION_COOKIE_PATH,
    httpOnly: true,
    secure: isProduction,
    sameSite: "Lax",
  };
}
