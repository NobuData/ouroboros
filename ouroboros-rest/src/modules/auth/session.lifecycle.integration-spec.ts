import { API_BASE_PATH } from "../../application";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_CACHE_SECONDS,
  SESSION_DATA_COOKIE,
  SESSION_EXPIRES_IN_SECONDS,
} from "../../auth/session.options";
import { ApiHarness, AUTH, ORGS } from "../../testing/harness.fixture";
import { bodyOf, setCookie } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { AUTH_ERRORS } from "./auth.errors";
import { sessionExists, sessionTokenIn } from "./session.fixture";

/**
 * What a session is worth, from the moment it is issued to the moment it is not.
 *
 * [#715](https://github.com/NobuData/ouroboros/issues/715)'s second bullet — *session
 * lifecycle: sign-out revokes; the old cookie 401s afterwards* — and its third acceptance
 * criterion, *a session that has been signed out cannot be replayed*.
 *
 * **This is not a second copy of `auth.integration-spec.ts`.** That suite mints sessions with
 * `session.fixture.ts` — an `insert` and a signed cookie — which is the right tool for a
 * suite whose subject is the guard, and it goes on asserting the cases that need a session in
 * a state a sign-in cannot produce: one whose person has been deleted, one already expired,
 * one that was never issued. What it cannot assert is the *lifecycle*, because a session
 * nobody signed in to get is not a session anybody can sign out of. Everything below starts
 * with a real sign-in.
 *
 * ## The one place the answer is more interesting than the criterion
 *
 * `SESSION_COOKIE_CACHE_SECONDS` is five minutes of signed snapshot in a second cookie, and
 * it is what makes #703's *≤ 1 DB query per request* true. It also means "cannot be replayed"
 * has to be read carefully, and this suite reads it out loud rather than around:
 *
 *   * The **row is gone** the instant sign-out returns. That is the revocation.
 *   * A replay of the **session token** is refused immediately — which is every replay that
 *     matters, because the token is the credential and the snapshot is a cache of it.
 *   * A replay of the **whole cookie pair, snapshot included**, is honoured until that
 *     snapshot goes stale. `session.options.ts` states this as the deliberate trade it is —
 *     the window is exactly how long a *copied* cookie can outlive a sign-out — and the tests
 *     below pin both the behaviour and the size of the window, so that shrinking it, or
 *     giving it up, is a decision somebody makes rather than one that drifts.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The signed snapshot in `better-auth.session_data`, as much of it as this suite reads. */
interface Snapshot {
  /** When the snapshot goes stale, in epoch milliseconds — *not* when the session expires. */
  readonly expiresAt: number;
  /** The session it is a snapshot of. */
  readonly session: { readonly session: { readonly token: string } };
}

describe("the life of a session", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** Only the named cookie out of a `Cookie` header — a browser that lost the other one. */
  const only = (cookie: string, name: string): string =>
    cookie
      .split("; ")
      .filter((pair) => pair.startsWith(`${name}=`))
      .join("; ");

  describe("what signing in issues", () => {
    it("is a row, which is what makes revocation a delete rather than a wait", async () => {
      const person = await api.signUp();

      const { rows } = await api.sql.query<{ token: string; expiresAt: Date }>(
        `select "token", "expiresAt" from ${SCHEMA_NAME}.session where "userId" = $1`,
        [person.id],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].token).toBe(sessionTokenIn(person.cookie));
    });

    it("lasts as long as this service said it would", async () => {
      // Seven days, from `session.options.ts`. Asserted within a minute rather than exactly,
      // because the row's clock is PostgreSQL's `now()` and the expectation's is this
      // process's.
      const person = await api.signUp();

      const { rows } = await api.sql.query<{ seconds: string }>(
        `select extract(epoch from ("expiresAt" - now()))::text as seconds
           from ${SCHEMA_NAME}.session where "userId" = $1`,
        [person.id],
      );

      expect(Number(rows[0].seconds)).toBeGreaterThan(SESSION_EXPIRES_IN_SECONDS - 60);
      expect(Number(rows[0].seconds)).toBeLessThanOrEqual(SESSION_EXPIRES_IN_SECONDS);
    });

    it("comes with a snapshot that goes stale long before the session does", async () => {
      // The cookie cache, as data. Five minutes against seven days is the whole shape of the
      // trade the header describes, and pinning it here is what makes a change to either
      // number visible.
      const person = await api.signUp();
      const snapshot = readSnapshot(person.cookie);

      const window = (snapshot.expiresAt - Date.now()) / 1000;
      expect(window).toBeGreaterThan(SESSION_COOKIE_CACHE_SECONDS - 60);
      expect(window).toBeLessThanOrEqual(SESSION_COOKIE_CACHE_SECONDS);
      expect(snapshot.session.session.token).toBe(sessionTokenIn(person.cookie));
    });
  });

  describe("signing out, through the library's own route", () => {
    it("deletes the row", async () => {
      const person = await api.signUp();
      expect(await sessionExists(api.sql, person.cookie)).toBe(true);

      await api.as(person)("post", `${AUTH}/sign-out`).send({}).expect(200);

      expect(await sessionExists(api.sql, person.cookie)).toBe(false);
    });

    it("clears both cookies, so the browser that asked stops holding either", async () => {
      const person = await api.signUp();

      const response = await api.as(person)("post", `${AUTH}/sign-out`).send({}).expect(200);

      expect(setCookie(response, SESSION_COOKIE)).toContain("Max-Age=0");
      expect(setCookie(response, SESSION_DATA_COOKIE)).toContain("Max-Age=0");
    });

    it("leaves that browser anonymous on the next request", async () => {
      // The harness's jar follows the removals, which is what a browser does — so this is the
      // ordinary experience of signing out rather than a replay.
      const person = await api.signUp();
      await api.as(person)("get", ORGS).expect(200);

      await api.as(person)("post", `${AUTH}/sign-out`).send({}).expect(200);

      const response = await api.as(person)("get", ORGS).expect(401);
      expect(bodyOf<ErrorEnvelope>(response).code).toBe(AUTH_ERRORS.unauthenticated);
    });

    it("ends one session and not the person's others", async () => {
      // Two browsers, one account, both from real sign-ins. Signing out of a shared machine
      // is not signing out of your own.
      const person = await api.signUp();
      const other = await api.signInWithPassword(person);

      await api.as(person)("post", `${AUTH}/sign-out`).send({}).expect(200);

      await api.as(other)("get", ORGS).expect(200);
    });
  });

  describe("this service's own logout alias", () => {
    it("revokes exactly as the library's route does", async () => {
      // `POST /api/v1/auth/logout` delegates rather than reimplementing — see
      // `auth.controller.ts`. The assertion that matters is that the *row* goes, because a
      // second implementation that only cleared cookies would pass every other test here.
      const person = await api.signUp();

      await api.as(person)("post", `${API_BASE_PATH}/auth/logout`).expect(204);

      expect(await sessionExists(api.sql, person.cookie)).toBe(false);
    });

    it("answers a browser with no session at all, which is why it is anonymous", async () => {
      // Requiring a session to dispose of one would mean an expired cookie could never be
      // cleared. It is one of the five entries in `SHIPPED_PUBLIC_SURFACE` for that reason.
      await api.anonymous("post", `${API_BASE_PATH}/auth/logout`).expect(204);
    });
  });

  describe("replaying a cookie copied before the sign-out", () => {
    it("is refused, when what was copied is the session token", async () => {
      // **The acceptance criterion.** The token is the credential; a copy of it is worth
      // nothing the moment the row is gone, rather than good for the rest of its week — which
      // is the property #703 replaced the stateless cookie to get, and the one #38 was opened
      // for.
      const person = await api.signUp();
      const stolen = only(person.cookie, SESSION_COOKIE);
      await api.anonymous("get", ORGS).set("Cookie", stolen).expect(200);

      await api.as(person)("post", `${AUTH}/sign-out`).send({}).expect(200);

      await api.anonymous("get", ORGS).set("Cookie", stolen).expect(401);
    });

    it("is refused for every other session of theirs that was also signed out", async () => {
      const person = await api.signUp();
      const other = await api.signInWithPassword(person);
      const stolen = only(other.cookie, SESSION_COOKIE);

      await api.as(other)("post", `${AUTH}/sign-out`).send({}).expect(200);

      await api.anonymous("get", ORGS).set("Cookie", stolen).expect(401);
    });

    it("is honoured while a copied snapshot is still fresh — the documented trade, pinned", async () => {
      // Not a gap that slipped through: `SESSION_COOKIE_CACHE_SECONDS` says in as many words
      // that the window is *how long a revoked session can still be honoured by a browser
      // that already held a fresh snapshot*, and it is what buys #703's one-query-per-request
      // criterion.
      //
      // It is asserted rather than left implicit because it is the one claim in this file
      // that a reader would otherwise have to take on trust, and because the day somebody
      // decides five minutes is too long, this is the test that tells them what they are
      // changing. The bound is asserted beside it — the row is gone, so the window is finite
      // and is exactly the snapshot's.
      const person = await api.signUp();
      const stolen = person.cookie;

      await api.as(person)("post", `${AUTH}/sign-out`).send({}).expect(200);

      expect(await sessionExists(api.sql, stolen)).toBe(false);
      await api.anonymous("get", ORGS).set("Cookie", stolen).expect(200);
      expect((readSnapshot(stolen).expiresAt - Date.now()) / 1000).toBeLessThanOrEqual(
        SESSION_COOKIE_CACHE_SECONDS,
      );
    });

    it("is refused the moment the snapshot is dropped, which is the cache and not a session", async () => {
      // The other half of the same claim, and the one that says the snapshot is a *cache*:
      // take it away and the same browser, with the same token, is refused.
      const person = await api.signUp();
      const stolen = person.cookie;

      await api.as(person)("post", `${AUTH}/sign-out`).send({}).expect(200);

      await api.anonymous("get", ORGS).set("Cookie", only(stolen, SESSION_COOKIE)).expect(401);
    });
  });

  describe("a session the database no longer honours", () => {
    it("is refused once its row has been deleted underneath it", async () => {
      // Revocation by any other means — an operator, a cascade, a future admin route. The
      // guard reads the row, so nothing else has to be told.
      const person = await api.signUp();

      await api.sql.query(`delete from ${SCHEMA_NAME}.session where "userId" = $1`, [person.id]);

      await api
        .anonymous("get", ORGS)
        .set("Cookie", only(person.cookie, SESSION_COOKIE))
        .expect(401);
    });

    it("is refused when the person is deleted, which takes their sessions with them", async () => {
      // V004's `on delete cascade`, as behaviour: removing the person removes the session in
      // the same statement, so the cookie names nothing a moment later.
      const person = await api.signUp();

      await api.sql.query(`delete from ${SCHEMA_NAME}."user" where "id" = $1`, [person.id]);

      await api
        .anonymous("get", ORGS)
        .set("Cookie", only(person.cookie, SESSION_COOKIE))
        .expect(401);
    });

    it("is refused once it has expired, whatever the cookie still says", async () => {
      // The expiry is on the row. A browser holding a cookie past it is refused by the server
      // rather than trusted to have stopped sending it.
      const person = await api.signUp();

      await api.sql.query(
        `update ${SCHEMA_NAME}.session set "expiresAt" = now() - interval '1 minute'
          where "userId" = $1`,
        [person.id],
      );

      await api
        .anonymous("get", ORGS)
        .set("Cookie", only(person.cookie, SESSION_COOKIE))
        .expect(401);
    });
  });

  describe("a cookie nobody signed", () => {
    it("is refused when the token was never issued", async () => {
      await api.anonymous("get", ORGS).set("Cookie", `${SESSION_COOKIE}=never-issued`).expect(401);
    });

    it("is refused when a real token carries a signature that is not this service's", async () => {
      // The half `better-auth.fixture.ts` could never assert, in as many words: it read
      // everything before the first `.` as the token and verified nothing. The real library
      // checks, so a token lifted out of a database and re-signed with the wrong secret buys
      // nothing.
      const person = await api.signUp();
      const token = sessionTokenIn(person.cookie);

      await api
        .anonymous("get", ORGS)
        .set("Cookie", `${SESSION_COOKIE}=${token}.not-the-signature`)
        .expect(401);
    });

    it("is refused when the token is presented with no signature at all", async () => {
      const person = await api.signUp();
      const token = sessionTokenIn(person.cookie);

      await api.anonymous("get", ORGS).set("Cookie", `${SESSION_COOKIE}=${token}`).expect(401);
    });
  });

  /**
   * The snapshot a browser is holding, decoded.
   *
   * The cookie is base64 of a JSON object carrying the session, when the snapshot goes stale,
   * and a signature over the pair. Only the first two are read here: the signature is the
   * library's to check, and this suite's assertions are about the *window* rather than about
   * the cryptography.
   *
   * @param cookie - A `Cookie` header value carrying `better-auth.session_data`.
   * @returns The snapshot.
   */
  function readSnapshot(cookie: string): Snapshot {
    const pair = cookie.split("; ").find((each) => each.startsWith(`${SESSION_DATA_COOKIE}=`));

    if (pair === undefined) {
      throw new Error(`No ${SESSION_DATA_COOKIE} in: ${cookie}`);
    }

    const value = decodeURIComponent(pair.slice(pair.indexOf("=") + 1));

    return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as Snapshot;
  }
});
