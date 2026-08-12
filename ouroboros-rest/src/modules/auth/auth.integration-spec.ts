import type { Server } from "node:http";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";

import { configureApplication } from "../../application";
import { bodyOf, integrationDatabaseUrl } from "../../testing/integration.fixture";
import { GITHUB_PROVIDER_ID } from "../../auth/github.provider";
import { AppModule } from "../app/app.module";
import { testConfiguration } from "../config/configuration.fixture";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { SESSION_COOKIE, SESSION_DATA_COOKIE } from "../../auth/session.options";
import { AUTH_ERRORS } from "./auth.errors";
import type { SessionResource } from "./auth.resources";
import { LEGACY_SESSION_COOKIE } from "./legacy.cookie";
import { sessionExists, signInAs } from "./session.fixture";

/**
 * What is left of this module against a real migrated PostgreSQL, and the one thing #702
 * added that a database is the only place to check.
 *
 * **This suite used to walk the whole browser sign-in.** #33's flow was this service's own,
 * so replacing `GithubClient` with an object left every other moving part real — the
 * handshake, the cookies, the identity upsert — and a Supertest run could assert the lot.
 * [#702](https://github.com/NobuData/ouroboros/issues/702) moved sign-in inside BetterAuth,
 * and BetterAuth is the one dependency these suites do **not** load: it is published as ES
 * modules, this service compiles to CommonJS, and `jest.integration.config.mjs` maps it to
 * `src/auth/better-auth.fixture.ts` for the reason written down in `jest.esm-transform.cjs`.
 * Asserting a sign-in against that stand-in would be asserting against a hundred lines this
 * repository wrote, which is worth nothing.
 *
 * So the flow's coverage moved rather than vanished, and it is worth saying where to:
 *
 *   * **The provider's configuration** — scopes, profile mapping, the account-linking
 *     policy — is `src/auth/github.provider.spec.ts`, where it is ordinary data.
 *   * **The four core tables and the back-fill into them** are
 *     `ouroboros-db/tests/constraints.sql`, run against a live PostgreSQL by `ci/db`.
 *   * **The full browser flow against a real GitHub OAuth app**, which is the issue's first
 *     acceptance criterion, is a manual check — `README.md` § Signing in says how — and
 *     [#715](https://github.com/NobuData/ouroboros/issues/715) is the issue that builds the
 *     automated suite for it, once #705's development password makes a sign-in reachable
 *     without github.com.
 *
 * What stays here is what this module still owns and a database still answers:
 *
 *   1. **The session the guard reads**, and everything `GET /api/v1/auth/me` joins to
 *      answer — memberships, the tenant suggestion, and a session whose person has been
 *      deleted since.
 *   2. **[#703](https://github.com/NobuData/ouroboros/issues/703)'s revocation**, which is
 *      the one acceptance criterion in this issue that only a database can answer: sign out,
 *      present the very same cookie, and be refused. The session is a row here — minted by
 *      `session.fixture.ts` and deleted by the library's `signOut` — so what is asserted is
 *      the mechanism rather than a stand-in for it.
 *   3. **That a person who signed in under #33 is the same person to BetterAuth**, which is
 *      the issue's second acceptance criterion and the one with a seeded pre-migration row
 *      in it. It is asserted here rather than only in SQL because the value being matched
 *      is `GITHUB_PROVIDER_ID` — a constant this service hands the library — and the point
 *      is that the string in `src/auth/` and the string V004 wrote agree.
 *
 * It takes a database the way `tenancy.integration-spec.ts` does — from the
 * [#37](https://github.com/NobuData/ouroboros/issues/37) harness, which starts one:
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The database this suite runs against. No default and no skip; see the tenancy suite. */
const DATABASE_URL = integrationDatabaseUrl();

/** What every row this suite creates is named with, so the cleanup can find it. */
const TEST_PREFIX = "ouro-auth-it";

/** The address the person in these tests holds. */
const EMAIL = `${TEST_PREFIX}-person@example.test`;

/** GitHub's immutable id for the account they signed in with under #33. */
const EXTERNAL_ID = "990000001";

/** A connection of this suite's own, for the setup and cleanup the application must not do. */
const admin = new Pool({ connectionString: DATABASE_URL, max: 1 });

/** The auth routes' base path. */
const AUTH = "/api/v1/auth";

/**
 * The whole `Set-Cookie` header for one cookie.
 *
 * @param response - What Supertest returned.
 * @param name - The cookie to find.
 * @returns The header, or an empty string.
 */
function cookieHeader(response: request.Response, name: string): string {
  const headers = (response.headers["set-cookie"] ?? []) as unknown as string[];

  return headers.find((candidate) => candidate.startsWith(`${name}=`)) ?? "";
}

describe("the auth surface, against a real database", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(testConfiguration({ OURO_DATABASE_URL: DATABASE_URL }))],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    // The same prefix, versioning, pipe and filter `createApplication` applies. Restating
    // them here would make this suite assert against a surface that is a copy of the real
    // one and free to drift from it.
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await cleanUp();
    await admin.end();
  });

  afterEach(cleanUp);

  /**
   * Remove everything this suite created.
   *
   * Three deletes rather than two. `tenants` and `users` cascade through V002's tables as
   * they always did; `"user"` needs its own, because V004 deliberately writes no foreign
   * key between the two generations of user table — which is what lets
   * [#708](https://github.com/NobuData/ouroboros/issues/708) drop the older pair. `account`
   * cascades from `"user"`.
   */
  async function cleanUp(): Promise<void> {
    await admin.query("delete from ouroboros.tenants where slug like $1", [`${TEST_PREFIX}-%`]);
    await admin.query("delete from ouroboros.users where email like $1", [`${TEST_PREFIX}-%`]);
    await admin.query('delete from ouroboros."user" where "email" like $1', [`${TEST_PREFIX}-%`]);
  }

  /** The adapter's server, typed so Supertest can be handed it without an `any`. */
  const server = (): Server => app.getHttpServer() as Server;

  /**
   * Create a person and give them a session, as a completed sign-in would have.
   *
   * The rows are written directly rather than walked to through a sign-in route, because
   * there is no longer a sign-in route in this service to walk — BetterAuth serves it, and
   * these suites do not load BetterAuth. What that leaves real is everything after the
   * sign-in: a `session` row, the cookie naming it, and a guard that reads both.
   *
   * @param displayName - What to call them.
   * @param lifetimeSeconds - How long the session lasts. A negative value mints one that has
   *   already expired, which is how "the guard checks the row rather than the cookie" is
   *   asserted.
   * @returns Their id and the `Cookie` header a signed-in browser would send.
   */
  async function signedInPerson(
    displayName = "Integration Person",
    lifetimeSeconds?: number,
  ): Promise<{ id: string; cookie: string }> {
    const { rows } = await admin.query<{ id: string }>(
      "insert into ouroboros.users (email, display_name) values ($1, $2) returning id",
      [EMAIL, displayName],
    );
    const id = rows[0].id;

    return { id, cookie: await signInAs(admin, id, lifetimeSeconds) };
  }

  describe("reading the session back", () => {
    it("answers with the person and their memberships", async () => {
      const { id, cookie } = await signedInPerson();

      const { rows } = await admin.query<{ id: string }>(
        "insert into ouroboros.tenants (slug, display_name) values ($1, $2) returning id",
        [`${TEST_PREFIX}-acme`, "Acme Integration"],
      );
      await admin.query(
        "insert into ouroboros.tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')",
        [rows[0].id, id],
      );

      const session = bodyOf<SessionResource>(
        await request(server()).get(`${AUTH}/me`).set("Cookie", cookie).expect(200),
      );

      expect(session.user.email).toBe(EMAIL);
      expect(session.memberships).toEqual([
        expect.objectContaining({ slug: `${TEST_PREFIX}-acme`, role: "owner" }),
      ]);
      expect(session.tenantSuggestion).toBeNull();
    });

    it("suggests the tenant that owns the address's domain, when there are no memberships", async () => {
      const { cookie } = await signedInPerson();

      const { rows } = await admin.query<{ id: string }>(
        "insert into ouroboros.tenants (slug, display_name) values ($1, $2) returning id",
        [`${TEST_PREFIX}-domain`, "Domain Owner"],
      );
      await admin.query(
        "insert into ouroboros.tenant_domains (tenant_id, domain) values ($1, $2)",
        [rows[0].id, "example.test"],
      );

      const session = bodyOf<SessionResource>(
        await request(server()).get(`${AUTH}/me`).set("Cookie", cookie).expect(200),
      );

      expect(session.memberships).toEqual([]);
      expect(session.tenantSuggestion).toEqual({
        tenantId: rows[0].id,
        slug: `${TEST_PREFIX}-domain`,
        displayName: "Domain Owner",
      });
    });

    it("refuses a request with no session", async () => {
      const response = await request(server()).get(`${AUTH}/me`).expect(401);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe(AUTH_ERRORS.unauthenticated);
    });

    it("refuses a session whose person has since been deleted", async () => {
      // V004's `on delete cascade` is what makes this true rather than a lookup this service
      // performs: removing the person removes their sessions in the same statement, so the
      // cookie names nothing a moment later. Under #33 the same case was a signature that
      // still verified over a row that had gone.
      const { cookie } = await signedInPerson();
      await admin.query('delete from ouroboros."user" where "email" = $1', [EMAIL]);

      await request(server()).get(`${AUTH}/me`).set("Cookie", cookie).expect(401);
    });

    it("refuses a session that has expired, whatever the cookie still says", async () => {
      // The expiry is on the row. A browser holding a cookie past it is refused by the
      // server rather than trusted to have stopped sending it.
      const { cookie } = await signedInPerson("Integration Person", -60);

      await request(server()).get(`${AUTH}/me`).set("Cookie", cookie).expect(401);
    });

    it("refuses a cookie naming a session that was never issued", async () => {
      await request(server())
        .get(`${AUTH}/me`)
        .set("Cookie", `${SESSION_COOKIE}=never-issued`)
        .expect(401);
    });
  });

  describe("a browser still holding #33's cookie", () => {
    // #703's fifth acceptance criterion, and the reason `legacy.cookie.ts` exists: the
    // cut-over invalidates every live session, and a browser that goes on sending
    // `ouro_session` must be refused cleanly and told to drop it — not answered with a 500
    // by something trying to verify a signature nothing checks any more.
    it("is refused with the envelope rather than a 500", async () => {
      const response = await request(server())
        .get(`${AUTH}/me`)
        .set("Cookie", `${LEGACY_SESSION_COOKIE}=whatever-it-used-to-hold`)
        .expect(401);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe(AUTH_ERRORS.unauthenticated);
    });

    it("is told to drop it", async () => {
      const response = await request(server())
        .get(`${AUTH}/me`)
        .set("Cookie", `${LEGACY_SESSION_COOKIE}=whatever-it-used-to-hold`)
        .expect(401);

      expect(cookieHeader(response, LEGACY_SESSION_COOKIE)).toContain("Max-Age=0");
    });

    it("is told to drop it on a route that answers, too", async () => {
      // The cookie is dead everywhere, so the eviction is a property of the request rather
      // than of the answer — which is why it is middleware and not a 401 handler.
      const response = await request(server())
        .get("/api/v1")
        .set("Cookie", `${LEGACY_SESSION_COOKIE}=whatever-it-used-to-hold`)
        .expect(200);

      expect(cookieHeader(response, LEGACY_SESSION_COOKIE)).toContain("Max-Age=0");
    });

    it("is left alone when it is not sending one", async () => {
      const response = await request(server()).get("/api/v1").expect(200);

      expect(cookieHeader(response, LEGACY_SESSION_COOKIE)).toBe("");
    });
  });

  describe("signing out", () => {
    it("answers 204 and removes both cookies", async () => {
      const { cookie } = await signedInPerson();

      const response = await request(server())
        .post(`${AUTH}/logout`)
        .set("Cookie", cookie)
        .expect(204);

      expect(cookieHeader(response, SESSION_COOKIE)).toContain("Max-Age=0");
      expect(cookieHeader(response, SESSION_DATA_COOKIE)).toContain("Max-Age=0");
      expect(response.body).toEqual({});
    });

    it("deletes the session row, which is what makes revocation immediate", async () => {
      // #703's third acceptance criterion, and the half #38 was opened for. Clearing the
      // browser's copy was all #33 could do; this is the server forgetting.
      const { cookie } = await signedInPerson();
      expect(await sessionExists(admin, cookie)).toBe(true);

      await request(server()).post(`${AUTH}/logout`).set("Cookie", cookie).expect(204);

      expect(await sessionExists(admin, cookie)).toBe(false);
    });

    it("refuses the very same cookie on the next request", async () => {
      // The criterion as a caller experiences it: a cookie copied before sign-out is worth
      // nothing after it, rather than good for the rest of its week.
      const { cookie } = await signedInPerson();
      await request(server()).get(`${AUTH}/me`).set("Cookie", cookie).expect(200);

      await request(server()).post(`${AUTH}/logout`).set("Cookie", cookie).expect(204);

      await request(server()).get(`${AUTH}/me`).set("Cookie", cookie).expect(401);
    });

    it("ends one session and not the person's others", async () => {
      // Two browsers, one account. Sign-out deletes the session that asked, so somebody
      // signing out of a shared machine is not signed out of their own.
      const { id, cookie } = await signedInPerson();
      const other = await signInAs(admin, id);

      await request(server()).post(`${AUTH}/logout`).set("Cookie", cookie).expect(204);

      await request(server()).get(`${AUTH}/me`).set("Cookie", other).expect(200);
    });

    it("works without a session, which is why it is anonymous", async () => {
      await request(server()).post(`${AUTH}/logout`).expect(204);
    });
  });

  describe("the sign-in routes this service used to serve", () => {
    // The issue's fourth acceptance criterion, as behaviour rather than as a `grep`:
    // `auth.controller.ts` removed them rather than forwarding them, and a route that
    // answered anything at all here would mean a second sign-in path had survived.
    it.each([
      ["beginning a sign-in", `${AUTH}/github`],
      ["the callback", `${AUTH}/github/callback`],
    ])(
      "answers 404 for %s, because #702 removed it rather than forwarding it",
      async (_what, path) => {
        await request(server()).get(path).expect(404);
      },
    );
  });

  describe("the rest of the API", () => {
    it("is closed to a request with no session", async () => {
      const response = await request(server()).get("/api/v1/tenants").expect(401);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe(AUTH_ERRORS.unauthenticated);
    });

    it("is open to one carrying a session the guard honours", async () => {
      const { cookie } = await signedInPerson();

      await request(server()).get("/api/v1/tenants").set("Cookie", cookie).expect(200);
    });
  });

  describe("a person who first signed in under the #33 flow", () => {
    /**
     * Seed the two rows #33's `resolveUser` wrote, and move them the way V004 does.
     *
     * The pre-migration state the acceptance criterion names: a `users` row and the
     * `user_identities` row that made a repeat sign-in find it. `backfill_betterauth_core`
     * is the migration's own function, called rather than reimplemented — a test that
     * copied the columns itself would pass against a migration that had stopped doing so.
     *
     * @returns The legacy user's id.
     */
    async function seedPreMigrationIdentity(): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        "insert into ouroboros.users (email, display_name, avatar_url) values ($1, $2, $3) returning id",
        [EMAIL, "Integration Person", "https://avatars.example/990000001"],
      );

      await admin.query(
        "insert into ouroboros.user_identities (user_id, provider, external_id) values ($1, 'github', $2)",
        [rows[0].id, EXTERNAL_ID],
      );
      await admin.query("select * from ouroboros.backfill_betterauth_core()");

      return rows[0].id;
    }

    it("is found by the pair BetterAuth looks a sign-in up by, and is the same person", async () => {
      // `findOAuthUser(email, accountId, providerId)` reads `account` by (accountId,
      // providerId) and joins the user. This is that query, with the provider id taken from
      // the constant this service configures the library with — so a rename on either side
      // fails here rather than at somebody's next sign-in.
      const legacyId = await seedPreMigrationIdentity();

      const { rows } = await admin.query<{ userId: string; email: string }>(
        'select a."userId", u."email" from ouroboros.account a ' +
          'join ouroboros."user" u on u."id" = a."userId" ' +
          'where a."providerId" = $1 and a."accountId" = $2',
        [GITHUB_PROVIDER_ID, EXTERNAL_ID],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(legacyId);
      expect(rows[0].email).toBe(EMAIL);
    });

    it("keeps the memberships they already held, because the id did not change", async () => {
      // What "the same person" is actually worth: `tenant_members.user_id` was written
      // against `users.id`, and the back-fill preserved it — so the workspace they were
      // invited to is still theirs after the move.
      const legacyId = await seedPreMigrationIdentity();

      const { rows } = await admin.query<{ id: string }>(
        "insert into ouroboros.tenants (slug, display_name) values ($1, $2) returning id",
        [`${TEST_PREFIX}-kept`, "Kept Workspace"],
      );
      await admin.query(
        "insert into ouroboros.tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')",
        [rows[0].id, legacyId],
      );

      const session = bodyOf<SessionResource>(
        await request(server())
          .get(`${AUTH}/me`)
          .set("Cookie", await signInAs(admin, legacyId))
          .expect(200),
      );

      expect(session.memberships).toEqual([
        expect.objectContaining({ slug: `${TEST_PREFIX}-kept`, role: "owner" }),
      ]);
    });

    it("arrives with a verified address, so account linking will attach to them", async () => {
      // The flag BetterAuth's linking consults. #33 accepted only a verified GitHub primary
      // address, so `true` is a fact about anybody holding an identity row — and if the
      // back-fill wrote `false`, an existing person would sign in and be given a second
      // account instead of their own.
      await seedPreMigrationIdentity();

      const { rows } = await admin.query<{ emailVerified: boolean; image: string | null }>(
        'select "emailVerified", "image" from ouroboros."user" where "email" = $1',
        [EMAIL],
      );

      expect(rows[0].emailVerified).toBe(true);
      expect(rows[0].image).toBe("https://avatars.example/990000001");
    });

    it("is moved once and not again, however often the back-fill runs", async () => {
      await seedPreMigrationIdentity();
      await admin.query("select * from ouroboros.backfill_betterauth_core()");

      const { rows } = await admin.query<{ count: string }>(
        'select count(*) as count from ouroboros."user" where "email" = $1',
        [EMAIL],
      );

      expect(rows[0].count).toBe("1");
    });
  });
});
