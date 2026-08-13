import { SESSION_COOKIE, SESSION_DATA_COOKIE } from "../../auth/session.options";
import {
  ApiHarness,
  AUTH,
  HARNESS_PASSWORD,
  ORGS,
  type Person,
} from "../../testing/harness.fixture";
import { bodyOf, setCookie } from "../../testing/integration.fixture";
import { PASSWORD_MIN_LENGTH } from "../../auth/password.provider";
import { SCHEMA_NAME } from "../db/schema";

/**
 * Signing in with a password — [#705](https://github.com/NobuData/ouroboros/issues/705)'s
 * development credential, exercised rather than configured.
 *
 * [#715](https://github.com/NobuData/ouroboros/issues/715)'s first bullet, and the one that
 * could not be written before it. `password.provider.spec.ts` asserts the *options object*:
 * that `enabled` follows `NODE_ENV`, that the floor is twelve, that `password.hash` is left
 * unset so the library's scrypt is what writes the column. Every one of those is a claim
 * about a literal, and a literal cannot answer the only question that matters — *does a
 * password buy a session*.
 *
 * It can be asked now because the integration suite loads the real BetterAuth
 * (`jest.integration.config.mjs`); until #715 it replaced the library, and a stand-in
 * answering `200` to a sign-in would have proved nothing but that the stand-in said so.
 *
 * So what is below is the whole path: a scrypt hash written into `account.password` by code
 * this repository did not write, compared against on the next request, and a `session` row
 * whose cookie the global guard then honours on the tenancy API. Nothing is arranged except
 * the address and the password.
 *
 * **Two harnesses, deliberately.** The suite's own runs as a developer's does; a second one
 * is started with `NODE_ENV=production` for the four cases about the *off* position, because
 * "no password can be exchanged for a session in production" is not a claim a development
 * build can make on its own behalf.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** What a completed sign-up or sign-in answers with. Only the id is read. */
interface SignedInBody {
  /** The person the library created or recognised. */
  readonly user: { readonly id: string; readonly email: string; readonly name: string };
}

/** What the library answers a refused credential with. */
interface AuthFailureBody {
  /** The library's own code — not this service's envelope; these are its routes. */
  readonly code: string;
  /** The sentence it goes with. */
  readonly message: string;
}

describe("signing in with a password", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /**
   * How many sessions somebody is holding.
   *
   * The suite's own connection rather than an API call, because "a session row exists" is
   * the claim and asking the API would be asking the thing under test.
   *
   * @param person - Whose.
   * @returns The count.
   */
  async function sessionCount(person: Person): Promise<number> {
    const { rows } = await api.sql.query<{ count: string }>(
      `select count(*)::text as count from ${SCHEMA_NAME}.session where "userId" = $1`,
      [person.id],
    );

    return Number(rows[0].count);
  }

  describe("signing up", () => {
    it("creates the person, and answers with them", async () => {
      const response = await api
        .anonymous("post", `${AUTH}/sign-up/email`)
        .send({ email: "ada@acme-robotics.test", name: "Ada Lovelace", password: HARNESS_PASSWORD })
        .expect(200);

      const { user } = bodyOf<SignedInBody>(response);
      expect(user).toMatchObject({ email: "ada@acme-robotics.test", name: "Ada Lovelace" });
    });

    it("writes a credential account, with the password hashed and not stored", async () => {
      // The acceptance criterion behind `password.hash` being left unset: the column holds
      // whatever the library's scrypt produced, and what it must not hold is the password.
      // Asserting *not equal* as well as *shaped like a hash* is deliberate — a hash function
      // that silently became the identity would satisfy the second on its own.
      const person = await api.signUp();

      const { rows } = await api.sql.query<{ providerId: string; password: string | null }>(
        `select "providerId", "password" from ${SCHEMA_NAME}.account where "userId" = $1`,
        [person.id],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].providerId).toBe("credential");
      expect(rows[0].password).not.toBe(HARNESS_PASSWORD);
      expect(rows[0].password).not.toContain(HARNESS_PASSWORD);
      expect(rows[0].password?.length).toBeGreaterThan(HARNESS_PASSWORD.length);
    });

    it("lands a session, rather than asking the caller to sign in with what they just made", async () => {
      // `autoSignIn: true`, as behaviour. It is what lets a scripted caller — which the e2e
      // suite is — get where it is going in one call rather than two.
      const person = await api.signUp();

      expect(await sessionCount(person)).toBe(1);
      await api.as(person)("get", ORGS).expect(200);
    });

    it("sets both cookies: the token, and the snapshot the cache is made of", async () => {
      const response = await api
        .anonymous("post", `${AUTH}/sign-up/email`)
        .send({
          email: "grace@acme-robotics.test",
          name: "Grace Hopper",
          password: HARNESS_PASSWORD,
        })
        .expect(200);

      expect(setCookie(response, SESSION_COOKIE)).toContain("HttpOnly");
      expect(setCookie(response, SESSION_DATA_COOKIE)).toContain("HttpOnly");
    });

    it("refuses a password under the floor this service set, rather than the library's", async () => {
      // Twelve, not the library's eight. The value is `PASSWORD_MIN_LENGTH`, and it is
      // imported rather than typed so that raising it is one edit — and so that a password
      // exactly one character short is what is sent, whatever the floor becomes.
      const response = await api
        .anonymous("post", `${AUTH}/sign-up/email`)
        .send({
          email: "short@acme-robotics.test",
          name: "Too Short",
          password: "a".repeat(PASSWORD_MIN_LENGTH - 1),
        })
        .expect(400);

      expect(bodyOf<AuthFailureBody>(response).code).toBe("PASSWORD_TOO_SHORT");
    });

    it("accepts one exactly at the floor, so the boundary is a floor and not a fence", async () => {
      await api
        .anonymous("post", `${AUTH}/sign-up/email`)
        .send({
          email: "exact@acme-robotics.test",
          name: "Exactly Long Enough",
          password: "a".repeat(PASSWORD_MIN_LENGTH),
        })
        .expect(200);
    });

    it("refuses a second account on an address that already has one", async () => {
      const person = await api.signUp();

      await api
        .anonymous("post", `${AUTH}/sign-up/email`)
        .send({ email: person.email, name: "Impostor", password: HARNESS_PASSWORD })
        .expect(422);
    });
  });

  describe("signing in", () => {
    it("exchanges the right password for a session that opens the API", async () => {
      const person = await api.signUp();
      const second = await api.signInWithPassword(person);

      await api.as(second)("get", ORGS).expect(200);
    });

    it("is a second session rather than the first one moved", async () => {
      // Two browsers, one account — the arrangement every revocation assertion needs, and
      // proof that signing in mints rather than reuses.
      const person = await api.signUp();
      await api.signInWithPassword(person);

      expect(await sessionCount(person)).toBe(2);
    });

    it("refuses the wrong password, and mints nothing", async () => {
      const person = await api.signUp();

      const response = await api
        .anonymous("post", `${AUTH}/sign-in/email`)
        .send({ email: person.email, password: `${HARNESS_PASSWORD}-wrong` })
        .expect(401);

      expect(bodyOf<AuthFailureBody>(response).code).toBe("INVALID_EMAIL_OR_PASSWORD");
      expect(await sessionCount(person)).toBe(1);
    });

    it("answers an address it has never seen exactly as it answers a wrong password", async () => {
      // The two are the same refusal on purpose: a different answer would let somebody
      // enumerate which addresses have accounts, which is the disclosure `discovery.service.ts`
      // goes to some length to avoid on the one route that is public.
      const person = await api.signUp();

      const wrong = await api
        .anonymous("post", `${AUTH}/sign-in/email`)
        .send({ email: person.email, password: `${HARNESS_PASSWORD}-wrong` })
        .expect(401);
      const unknown = await api
        .anonymous("post", `${AUTH}/sign-in/email`)
        .send({ email: "nobody@acme-robotics.test", password: HARNESS_PASSWORD })
        .expect(401);

      expect(bodyOf<AuthFailureBody>(unknown)).toEqual(bodyOf<AuthFailureBody>(wrong));
    });

    it("leaves the address folded the way the rest of the API folds one", async () => {
      const person = await api.signUp({ email: "Mixed.Case@Acme-Robotics.test" });

      const { rows } = await api.sql.query<{ email: string }>(
        `select "email" from ${SCHEMA_NAME}."user" where "id" = $1`,
        [person.id],
      );

      expect(rows[0].email).toBe("mixed.case@acme-robotics.test");
    });
  });

  describe("what a new account is given", () => {
    it("gets a personal organization, and a session already acting in it", async () => {
      // #704's session hook, reached the only way it is ever reached in production: by
      // somebody signing in. `active.organization.spec.ts` asserts the hook's logic against
      // an in-memory store; this asserts that it is *wired*, which is the half a unit test of
      // a pure function cannot reach.
      const person = await api.signUp({ displayName: "Maya Chen" });

      const { rows } = await api.sql.query<{
        name: string;
        metadata: string | null;
        activeOrganizationId: string | null;
        organizationId: string;
        role: string;
      }>(
        `select o."name", o."metadata", s."activeOrganizationId", m."organizationId", m."role"
           from ${SCHEMA_NAME}.member m
           join ${SCHEMA_NAME}.organization o on o."id" = m."organizationId"
           join ${SCHEMA_NAME}.session s on s."userId" = m."userId"
          where m."userId" = $1`,
        [person.id],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Maya Chen");
      expect(rows[0].role).toBe("owner");
      expect(rows[0].metadata).toContain("personal");
      expect(rows[0].activeOrganizationId).toBe(rows[0].organizationId);
    });

    it("can reach the tenancy API immediately, with no workspace chosen by hand", async () => {
      // The end of the chain, and the reason the hook exists at all: without a personal
      // organization a brand-new person's every tenant-scoped request would be
      // `400 organization_required` with nowhere to go.
      const person = await api.signUp({ displayName: "Maya Chen" });

      const response = await api.as(person)("get", ORGS).expect(200);

      expect(bodyOf<{ items: { personal: boolean; roles: string[] }[] }>(response).items).toEqual([
        expect.objectContaining({ personal: true, roles: ["owner"] }),
      ]);
    });
  });

  describe("in production, where this way in does not exist", () => {
    let production: ApiHarness;

    beforeAll(async () => {
      // A second application, on a second port, over the same database. It is the same code
      // with one variable different, which is exactly the claim: nothing but `NODE_ENV`
      // stands between the two postures.
      production = await ApiHarness.start({ NODE_ENV: "production" });
    });

    afterAll(() => production.close());

    // **400, not 404**, and `password.provider.ts` says why at length: the library leaves the
    // routes mounted and makes their handlers refuse. Asserting 404 here would be asserting
    // something the library has never done, and would pass only until somebody looked.
    it.each([
      ["signing up", "sign-up/email", "EMAIL_PASSWORD_SIGN_UP_DISABLED"],
      ["signing in", "sign-in/email", "EMAIL_PASSWORD_DISABLED"],
    ])("refuses %s", async (_what, route, code) => {
      const response = await production
        .anonymous("post", `${AUTH}/${route}`)
        .send({ email: "ada@acme-robotics.test", name: "Ada Lovelace", password: HARNESS_PASSWORD })
        .expect(400);

      expect(bodyOf<AuthFailureBody>(response).code).toBe(code);
    });

    it("cannot be signed into with an account a development build created", async () => {
      // The case that would matter if the two ever shared a database, and the one a test of
      // the options object cannot express: the credential exists, the hash verifies, and the
      // route still refuses.
      const person = await api.signUp();

      const response = await production
        .anonymous("post", `${AUTH}/sign-in/email`)
        .send({ email: person.email, password: HARNESS_PASSWORD })
        .expect(400);

      expect(bodyOf<AuthFailureBody>(response).code).toBe("EMAIL_PASSWORD_DISABLED");
    });

    it("still serves the GitHub sign-in, which is the way in it does have", async () => {
      // The other direction. A production build that refused everything would satisfy every
      // assertion above and be useless.
      await production
        .anonymous("post", `${AUTH}/sign-in/social`)
        .send({ provider: "github", callbackURL: "/" })
        .expect(200);
    });
  });
});
