/**
 * A signed-in browser, for the suites that need one.
 *
 * Every route but sign-out, the heartbeat and the probes needs a session
 * ([#703](https://github.com/NobuData/ouroboros/issues/703)), so any suite that exercises
 * the API over HTTP has to carry one — and the alternative to this file is each of them
 * inserting a row and composing a cookie header by hand and getting the separator wrong
 * once.
 *
 * It mints a **real** session, and since #703 that means a real *row*: an insert into
 * `ouroboros.session` against the same database the application under test reads, with the
 * cookie BetterAuth's own client would send. Nothing here is a bypass. A suite using it is
 * exercising the global guard rather than avoiding it, which is the difference between a
 * test that proves the tenancy API works for a signed-in caller and a test that proves
 * nothing because authentication was switched off underneath it.
 *
 * That the row is real is also what makes the acceptance criteria assertable: a suite can
 * delete it — or call sign-out — and watch the very same cookie stop working, which is the
 * property #33's stateless cookie could not have been tested for because it did not have it.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import { createHmac, randomUUID } from "node:crypto";

import { SESSION_COOKIE } from "../../auth/session.options";
import { SCHEMA_NAME } from "../db/schema";

/** The one thing this fixture needs of a connection: something that can run a statement. */
export interface Queryable {
  query<T>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Sign a session token the way BetterAuth signs one.
 *
 * **This is what [#715](https://github.com/NobuData/ouroboros/issues/715) made necessary.**
 * Until that issue the integration suite replaced the library, and its stand-in read
 * everything before the first `.` as the token and verified nothing — so an unsigned cookie
 * worked, and this fixture emitted one. The suite now loads the real library
 * (`jest.integration.config.mjs`), and the real library *checks*: an unsigned token is a
 * cookie it discards before it ever reaches the database, which would make every suite
 * below fail with `401` for a reason that has nothing to do with what it was asserting.
 *
 * Reproduced here in six lines rather than imported, and the reason is the same one
 * `auth.options.ts` gives for its own restatements — plus one specific to a fixture. The
 * signing lives in `better-call`'s `signCookieValue`, which is an ES module this file's
 * *unit*-suite callers could not load; a fixture that could only be loaded by one of the
 * two runners would be a fixture that has to be duplicated. What it costs is that a change
 * to the library's cookie format is a failure here rather than a compile error — and that
 * failure is the honest one, because it is exactly what a browser holding an old cookie
 * would see.
 *
 * The format is `<token>.<signature>`, URI-encoded as a whole: the signature is an
 * HMAC-SHA256 of the token under the service's secret, base64 with padding, so it carries
 * `+`, `/` and `=` and cannot go into a cookie unescaped.
 *
 * @param token - The `session.token` value the row carries.
 * @param secret - `BETTER_AUTH_SECRET`, as the application under test was configured with
 *   it. A different secret signs a cookie the application will refuse, which is a case
 *   worth being able to arrange and therefore a parameter rather than a constant.
 * @returns The cookie value, ready to be given a name.
 */
export function signSessionToken(token: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(token).digest("base64");

  return encodeURIComponent(`${token}.${signature}`);
}

/**
 * How long a minted session lasts, in seconds — an hour.
 *
 * Deliberately *not* the service's seven days. A fixture's session only has to outlive the
 * test that made it, and a shorter window means a row leaked by a failed run cannot be
 * mistaken for a real one by anybody looking at a development database later.
 */
export const FIXTURE_SESSION_SECONDS = 60 * 60;

/** What {@link sessionCookieFor} needs beyond the person it is signing in. */
export interface SessionOptions {
  /**
   * `BETTER_AUTH_SECRET`, as the application under test was configured with it.
   *
   * Required rather than defaulted, since #715. A default would be a second statement of a
   * value the application already has, and the failure it would cause — a cookie signed
   * under one secret presented to a service running another — reads as `401 unauthenticated`
   * with nothing to say which of the two was wrong.
   */
  readonly secret: string;
  /**
   * How long it is good for. Defaults to {@link FIXTURE_SESSION_SECONDS}; a suite asserting
   * on expiry passes a negative number to mint one that is already stale.
   */
  readonly lifetimeSeconds?: number;
}

/**
 * Give somebody a session, and the cookie their browser would carry.
 *
 * The `"user"` row has to exist first: `session.userId` references it. Suites arrange that
 * through `ApiHarness.signIn` — see `src/testing/harness.fixture.ts`.
 *
 * @param sql - A connection to the application's database.
 * @param userId - Whose session: a real `ouroboros."user".id`.
 * @param options - The signing secret, and how long the session lasts.
 * @returns The `Cookie` header value, ready for Supertest's `.set("Cookie", …)`.
 */
export async function sessionCookieFor(
  sql: Queryable,
  userId: string,
  options: SessionOptions,
): Promise<string> {
  const token = randomUUID();

  await sql.query(
    `insert into ${SCHEMA_NAME}.session ("id", "token", "userId", "expiresAt", "updatedAt")
     values ($1, $2, $3, now() + make_interval(secs => $4), now())`,
    [randomUUID(), token, userId, options.lifetimeSeconds ?? FIXTURE_SESSION_SECONDS],
  );

  return `${SESSION_COOKIE}=${signSessionToken(token, options.secret)}`;
}

/**
 * Sign an existing `ouroboros."user"` row in.
 *
 * One statement, and it used to be two. A person was two rows until
 * [#708](https://github.com/NobuData/ouroboros/issues/708) — the tenancy `users` row every
 * foreign key pointed at, and BetterAuth's `"user"` row the session referenced, keyed by one
 * id by V004's back-fill. V006 dropped the first, so this is now exactly
 * {@link sessionCookieFor} and is kept as the name every suite already calls.
 *
 * @param sql - A connection to the application's database.
 * @param userId - An existing `ouroboros."user".id`.
 * @param options - The signing secret, and how long the session lasts; see
 *   {@link sessionCookieFor}.
 * @returns The `Cookie` header value a request from them carries.
 */
export async function signInAs(
  sql: Queryable,
  userId: string,
  options: SessionOptions,
): Promise<string> {
  return sessionCookieFor(sql, userId, options);
}

/**
 * Is this session still in the database?
 *
 * The assertion sign-out is worth making: `204` and a cleared cookie prove the browser was
 * told, and only the absence of the row proves the *server* stopped honouring it — which is
 * the half #38 was opened for.
 *
 * @param sql - A connection to the application's database.
 * @param cookie - A header value from {@link sessionCookieFor}.
 * @returns Whether a row still carries that token, expired or not. Expiry is deliberately
 *   not filtered: "gone" and "stale" are different states and sign-out promises the first.
 */
export async function sessionExists(sql: Queryable, cookie: string): Promise<boolean> {
  const { rows } = await sql.query<{ count: string }>(
    `select count(*)::text as count from ${SCHEMA_NAME}.session where "token" = $1`,
    [sessionTokenIn(cookie)],
  );

  return rows[0].count !== "0";
}

/**
 * The `session.token` a cookie names.
 *
 * The inverse of {@link signSessionToken}, and it has to undo both halves in order: the
 * whole value is URI-encoded, and the token is what precedes the signature's `.`. Reading
 * the raw value as a token — which is what this did before #715, when there was no
 * signature to strip — now finds no row at all.
 *
 * @param cookie - A header value from {@link sessionCookieFor}, `name=value`.
 * @returns The token the row is keyed by.
 */
export function sessionTokenIn(cookie: string): string {
  const value = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));

  return value.split(".")[0];
}
