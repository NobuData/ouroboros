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

import { randomUUID } from "node:crypto";

import { SESSION_COOKIE } from "../../auth/session.options";
import { SCHEMA_NAME } from "../db/schema";

/** The one thing this fixture needs of a connection: something that can run a statement. */
export interface Queryable {
  query<T>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
}

/**
 * How long a minted session lasts, in seconds — an hour.
 *
 * Deliberately *not* the service's seven days. A fixture's session only has to outlive the
 * test that made it, and a shorter window means a row leaked by a failed run cannot be
 * mistaken for a real one by anybody looking at a development database later.
 */
export const FIXTURE_SESSION_SECONDS = 60 * 60;

/**
 * Give somebody a session, and the cookie their browser would carry.
 *
 * The `"user"` row has to exist first: `session.userId` references it. Suites arrange that
 * through `ApiHarness.signIn`, which writes both tables — see `src/testing/harness.fixture.ts`.
 *
 * @param sql - A connection to the application's database.
 * @param userId - Whose session: a real `ouroboros."user".id`, which — V004 having
 *   preserved ids — is also their `ouroboros.users.id`.
 * @param lifetimeSeconds - How long it is good for. Defaults to
 *   {@link FIXTURE_SESSION_SECONDS}; a suite asserting on expiry passes a negative number to
 *   mint one that is already stale.
 * @returns The `Cookie` header value, ready for Supertest's `.set("Cookie", …)`.
 */
export async function sessionCookieFor(
  sql: Queryable,
  userId: string,
  lifetimeSeconds: number = FIXTURE_SESSION_SECONDS,
): Promise<string> {
  const token = randomUUID();

  await sql.query(
    `insert into ${SCHEMA_NAME}.session ("id", "token", "userId", "expiresAt", "updatedAt")
     values ($1, $2, $3, now() + make_interval(secs => $4), now())`,
    [randomUUID(), token, userId, lifetimeSeconds],
  );

  return `${SESSION_COOKIE}=${token}`;
}

/**
 * Sign an existing `ouroboros.users` row in.
 *
 * Two statements, because a person is currently two rows: the tenancy `users` row every
 * foreign key points at, and BetterAuth's `"user"` row the session references. V004's
 * back-fill is what made that pair, keyed by one id, and this reproduces it for somebody a
 * suite inserted afterwards — which is the honest arrangement until
 * [#708](https://github.com/NobuData/ouroboros/issues/708) collapses the two back to one.
 *
 * @param sql - A connection to the application's database.
 * @param userId - An existing `ouroboros.users.id`.
 * @param lifetimeSeconds - How long the session is good for; see {@link sessionCookieFor}.
 * @returns The `Cookie` header value a request from them carries.
 */
export async function signInAs(
  sql: Queryable,
  userId: string,
  lifetimeSeconds: number = FIXTURE_SESSION_SECONDS,
): Promise<string> {
  await sql.query(
    `insert into ${SCHEMA_NAME}."user" ("id", "name", "email", "emailVerified", "image",
                                       "createdAt", "updatedAt")
     select u.id::text, u.display_name, u.email, true, u.avatar_url, u.created_at, u.updated_at
       from ${SCHEMA_NAME}.users u
      where u.id = $1
     on conflict ("id") do nothing`,
    [userId],
  );

  return sessionCookieFor(sql, userId, lifetimeSeconds);
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
    [cookie.slice(cookie.indexOf("=") + 1)],
  );

  return rows[0].count !== "0";
}
