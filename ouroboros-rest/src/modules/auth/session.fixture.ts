/**
 * A signed-in browser, for the suites that need one.
 *
 * Every route but sign-in, sign-out, the heartbeat and the probes needs a session
 * ([#33](https://github.com/NobuData/ouroboros/issues/33)), so any suite that exercises the
 * API over HTTP has to carry one — and the alternative to this file is each of them
 * building a cookie header by hand from two constants and getting the separator wrong once.
 *
 * It mints a **real** session: the same `issueSession` the callback route uses, signed with
 * the same `OURO_SESSION_SECRET` the application under test was configured with. Nothing
 * here is a bypass. A suite using it is exercising the guard rather than avoiding it, which
 * is the difference between a test that proves the tenancy API works for a signed-in caller
 * and a test that proves nothing because authentication was switched off underneath it.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import { serializeCookie } from "./cookies";
import { issueSession, sessionCookieAttributes, SESSION_COOKIE } from "./session";

/**
 * The `Cookie` header a request from a signed-in browser carries.
 *
 * @param userId - Whose session — a real `ouroboros.users.id`, because the guard reads the
 *   row and refuses a session naming nobody.
 * @param secret - The signing key the application under test was configured with.
 * @param now - When the session was issued. Defaults to now; a test bounding the lifetime
 *   passes something older.
 * @returns The header value, ready for Supertest's `.set("Cookie", …)`.
 */
export function sessionCookieFor(userId: string, secret: string, now: Date = new Date()): string {
  return `${SESSION_COOKIE}=${issueSession(userId, secret, now)}`;
}

/**
 * The whole `Set-Cookie` header a session would be issued with.
 *
 * @param userId - Whose session.
 * @param secret - The signing key.
 * @param isProduction - Whether `Secure` is set.
 * @returns The header, for a test asserting on attributes rather than on the value.
 */
export function sessionSetCookieFor(userId: string, secret: string, isProduction = false): string {
  return serializeCookie(
    SESSION_COOKIE,
    issueSession(userId, secret, new Date()),
    sessionCookieAttributes(isProduction),
  );
}
