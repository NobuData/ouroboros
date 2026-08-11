import type { Server } from "node:http";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";

import { configureApplication } from "../../application";
import { AppModule } from "../app/app.module";
import { testConfiguration } from "../config/configuration.fixture";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { AUTH_ERRORS } from "./auth.errors";
import type { SessionResource } from "./auth.resources";
import { GithubClient, type GithubProfile } from "./github";
import { HANDSHAKE_COOKIE } from "./oauth";
import { SESSION_COOKIE } from "./session";

/**
 * Sign-in, end to end, against a real migrated PostgreSQL — with github.com replaced and
 * nothing else.
 *
 * > *Full browser flow against a real GitHub OAuth app lands a session; `/auth/me` returns
 * > the seeded-or-created user with memberships.*
 * > *CSRF-safe (state verified); cookies httpOnly.*
 * > *Repeat login with the same GitHub identity reuses the same user row.*
 *
 * All three acceptance criteria are here, and each of them is a claim a unit suite cannot
 * settle. "The same user row is reused" is a statement about `user_identities`' unique
 * index; "somebody invited before they signed in keeps their membership" is a statement
 * about two tables agreeing; and the redirect-cookie-redirect-cookie sequence is a
 * statement about the whole pipeline — guard, pipe, filter, controller — rather than about
 * any one of them.
 *
 * **Only `GithubClient` is replaced.** Everything else is the application the process runs:
 * the real module tree, the real global guard, the real cookies. The one thing this cannot
 * cover is github.com's own behaviour, which is why the criterion says *against a real
 * GitHub OAuth app* and the README says how to do that by hand.
 *
 * It takes a database the way `tenancy.integration-spec.ts` does:
 *
 * ```bash
 * docker compose up -d
 * OURO_DATABASE_URL=postgresql://ouroboros:ouroboros@localhost:5432/ouroboros \
 *   yarn test:integration
 * ```
 */

/** The database this suite runs against. No default and no skip; see the tenancy suite. */
const DATABASE_URL = process.env.OURO_DATABASE_URL;

if (DATABASE_URL === undefined || DATABASE_URL === "") {
  throw new Error(
    "The integration suite needs a migrated database. Start one with `docker compose up -d` " +
      "and run it with OURO_DATABASE_URL set — see the header of this file.",
  );
}

/** What every row this suite creates is named with, so the cleanup can find it. */
const TEST_PREFIX = "ouro-auth-it";

/** The GitHub account this suite signs in as. */
const PROFILE: GithubProfile = {
  externalId: "990000001",
  login: `${TEST_PREFIX}-login`,
  displayName: "Integration Person",
  email: `${TEST_PREFIX}-person@example.test`,
  avatarUrl: "https://avatars.example/990000001",
};

/** A connection of this suite's own, for the setup and cleanup the application must not do. */
const admin = new Pool({ connectionString: DATABASE_URL, max: 1 });

/** The auth routes' base path. */
const AUTH = "/api/v1/auth";

/**
 * A response's body, typed as the resource the contract says that operation answers with.
 *
 * @param response - What Supertest returned.
 * @returns Its body, typed.
 */
function bodyOf<T>(response: request.Response): T {
  return response.body as T;
}

/**
 * One named cookie's value out of a `Set-Cookie` list.
 *
 * @param response - What Supertest returned.
 * @param name - The cookie to find.
 * @returns Its value, or `undefined`.
 */
function cookieValue(response: request.Response, name: string): string | undefined {
  const headers = (response.headers["set-cookie"] ?? []) as unknown as string[];
  const header = headers.find((candidate) => candidate.startsWith(`${name}=`));

  return header?.slice(name.length + 1, header.indexOf(";"));
}

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

describe("signing in, for real", () => {
  let app: INestApplication;

  beforeAll(async () => {
    // The only substitution: github.com. Everything the request passes through on its way
    // to and from this double is the application the process builds.
    const github: Pick<GithubClient, "exchangeCode" | "readProfile"> = {
      exchangeCode: () => Promise.resolve("gho_integration_token"),
      readProfile: () => Promise.resolve(PROFILE),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(testConfiguration({ OURO_DATABASE_URL: DATABASE_URL }))],
    })
      .overrideProvider(GithubClient)
      .useValue(github)
      .compile();

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

  /** Remove everything this suite created. Identities and memberships cascade. */
  async function cleanUp(): Promise<void> {
    await admin.query("delete from ouroboros.tenants where slug like $1", [`${TEST_PREFIX}-%`]);
    await admin.query("delete from ouroboros.users where email like $1", [`${TEST_PREFIX}-%`]);
  }

  /** The adapter's server, typed so Supertest can be handed it without an `any`. */
  const server = (): Server => app.getHttpServer() as Server;

  /**
   * Walk the whole browser flow and come back with the session cookie.
   *
   * @returns The `Cookie` header a signed-in browser would then send.
   */
  async function signIn(): Promise<string> {
    const started = await request(server()).get(`${AUTH}/github`).expect(302);

    const state = new URL(started.headers.location).searchParams.get("state");
    const handshake = cookieValue(started, HANDSHAKE_COOKIE);

    const finished = await request(server())
      .get(`${AUTH}/github/callback`)
      .query({ code: "the-code", state })
      .set("Cookie", `${HANDSHAKE_COOKIE}=${handshake}`)
      .expect(302);

    return `${SESSION_COOKIE}=${cookieValue(finished, SESSION_COOKIE)}`;
  }

  /** The user row behind a GitHub identity, read directly. */
  async function storedUser(): Promise<{ id: string; email: string; display_name: string }> {
    const { rows } = await admin.query<{ id: string; email: string; display_name: string }>(
      "select u.id, u.email, u.display_name from ouroboros.users u " +
        "join ouroboros.user_identities i on i.user_id = u.id " +
        "where i.provider = 'github' and i.external_id = $1",
      [PROFILE.externalId],
    );

    return rows[0];
  }

  describe("the handshake", () => {
    it("sends the browser to GitHub and remembers the trip in an HttpOnly cookie", async () => {
      const response = await request(server()).get(`${AUTH}/github`).expect(302);

      expect(response.headers.location).toContain("https://github.com/login/oauth/authorize");
      expect(cookieHeader(response, HANDSHAKE_COOKIE)).toContain("HttpOnly");
      expect(cookieHeader(response, HANDSHAKE_COOKIE)).toContain("Path=/api/v1/auth");
    });

    it("refuses a callback whose state was not the one it issued", async () => {
      // The CSRF defence, end to end: an attacker can put anything in the query string and
      // cannot put anything in the cookie.
      const started = await request(server()).get(`${AUTH}/github`).expect(302);

      const response = await request(server())
        .get(`${AUTH}/github/callback`)
        .query({ code: "the-code", state: "a-state-nobody-issued" })
        .set("Cookie", `${HANDSHAKE_COOKIE}=${cookieValue(started, HANDSHAKE_COOKIE)}`)
        .expect(401);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe(AUTH_ERRORS.handshakeInvalid);
    });

    it("refuses a callback that carries no handshake cookie at all", async () => {
      const started = await request(server()).get(`${AUTH}/github`).expect(302);
      const state = new URL(started.headers.location).searchParams.get("state");

      await request(server())
        .get(`${AUTH}/github/callback`)
        .query({ code: "the-code", state })
        .expect(401);
    });

    it("refuses a callback with no code, before anything is spent on it", async () => {
      const response = await request(server()).get(`${AUTH}/github/callback`).expect(422);

      expect(bodyOf<ErrorEnvelope>(response).details).toHaveProperty("code");
    });
  });

  describe("the session it lands", () => {
    it("is HttpOnly and sent for every path", async () => {
      const started = await request(server()).get(`${AUTH}/github`).expect(302);
      const state = new URL(started.headers.location).searchParams.get("state");

      const finished = await request(server())
        .get(`${AUTH}/github/callback`)
        .query({ code: "the-code", state })
        .set("Cookie", `${HANDSHAKE_COOKIE}=${cookieValue(started, HANDSHAKE_COOKIE)}`)
        .expect(302);

      expect(cookieHeader(finished, SESSION_COOKIE)).toContain("HttpOnly");
      expect(cookieHeader(finished, SESSION_COOKIE)).toContain("Path=/");
      expect(cookieHeader(finished, SESSION_COOKIE)).toContain("SameSite=Lax");
    });

    it("clears the spent handshake in the same answer", async () => {
      const started = await request(server()).get(`${AUTH}/github`).expect(302);
      const state = new URL(started.headers.location).searchParams.get("state");

      const finished = await request(server())
        .get(`${AUTH}/github/callback`)
        .query({ code: "the-code", state })
        .set("Cookie", `${HANDSHAKE_COOKIE}=${cookieValue(started, HANDSHAKE_COOKIE)}`)
        .expect(302);

      expect(cookieHeader(finished, HANDSHAKE_COOKIE)).toContain("Max-Age=0");
    });

    it("sends the browser on to the UI", async () => {
      const started = await request(server()).get(`${AUTH}/github`).expect(302);
      const state = new URL(started.headers.location).searchParams.get("state");

      const finished = await request(server())
        .get(`${AUTH}/github/callback`)
        .query({ code: "the-code", state })
        .set("Cookie", `${HANDSHAKE_COOKIE}=${cookieValue(started, HANDSHAKE_COOKIE)}`);

      expect(finished.headers.location).toBe("http://localhost:3000");
    });
  });

  describe("who the person becomes", () => {
    it("creates the person and the identity on a first sign-in", async () => {
      await signIn();

      const user = await storedUser();
      expect(user.email).toBe(PROFILE.email);
      expect(user.display_name).toBe(PROFILE.displayName);
    });

    it("reuses the same row on a repeat sign-in — the issue's third criterion", async () => {
      await signIn();
      const first = await storedUser();

      await signIn();
      const second = await storedUser();

      expect(second.id).toBe(first.id);

      const { rows } = await admin.query<{ count: string }>(
        "select count(*) as count from ouroboros.users where email = $1",
        [PROFILE.email],
      );
      expect(rows[0].count).toBe("1");
    });

    it("attaches the identity to the person an invitation created", async () => {
      // The stub row `MembersRepository.createUser` writes so an invitation has something
      // to point at. Signing in has to *become* that person, not create a second one — or
      // the invitation is silently lost and there is nothing to notice it by.
      const { rows } = await admin.query<{ id: string }>(
        "insert into ouroboros.users (email, display_name) values ($1, $2) returning id",
        [PROFILE.email, PROFILE.email],
      );
      const invited = rows[0].id;

      await signIn();

      expect((await storedUser()).id).toBe(invited);
    });

    it("refreshes the name GitHub reports without touching the address", async () => {
      await admin.query("insert into ouroboros.users (email, display_name) values ($1, $2)", [
        PROFILE.email,
        "Whoever They Were",
      ]);

      await signIn();

      const user = await storedUser();
      expect(user.display_name).toBe(PROFILE.displayName);
      expect(user.email).toBe(PROFILE.email);
    });
  });

  describe("reading the session back", () => {
    it("answers with the person and their memberships", async () => {
      const cookie = await signIn();
      const user = await storedUser();

      const { rows } = await admin.query<{ id: string }>(
        "insert into ouroboros.tenants (slug, display_name) values ($1, $2) returning id",
        [`${TEST_PREFIX}-acme`, "Acme Integration"],
      );
      await admin.query(
        "insert into ouroboros.tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')",
        [rows[0].id, user.id],
      );

      const session = bodyOf<SessionResource>(
        await request(server()).get(`${AUTH}/me`).set("Cookie", cookie).expect(200),
      );

      expect(session.user.email).toBe(PROFILE.email);
      expect(session.memberships).toEqual([
        expect.objectContaining({ slug: `${TEST_PREFIX}-acme`, role: "owner" }),
      ]);
      expect(session.tenantSuggestion).toBeNull();
    });

    it("suggests the tenant that owns the address's domain, when there are no memberships", async () => {
      const cookie = await signIn();

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
      // The reason the cookie carries an id rather than a copy of the person: the signature
      // is still perfectly good and there is no row behind it.
      const cookie = await signIn();
      await admin.query("delete from ouroboros.users where email = $1", [PROFILE.email]);

      await request(server()).get(`${AUTH}/me`).set("Cookie", cookie).expect(401);
    });
  });

  describe("signing out", () => {
    it("answers 204 and removes the cookie", async () => {
      const cookie = await signIn();

      const response = await request(server())
        .post(`${AUTH}/logout`)
        .set("Cookie", cookie)
        .expect(204);

      expect(cookieHeader(response, SESSION_COOKIE)).toContain("Max-Age=0");
      expect(response.body).toEqual({});
    });

    it("works without a session, which is why it is public", async () => {
      await request(server()).post(`${AUTH}/logout`).expect(204);
    });
  });

  describe("the rest of the API", () => {
    it("is closed to a request with no session", async () => {
      const response = await request(server()).get("/api/v1/tenants").expect(401);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe(AUTH_ERRORS.unauthenticated);
    });

    it("is open to one that signed in through the flow above", async () => {
      const cookie = await signIn();

      await request(server()).get("/api/v1/tenants").set("Cookie", cookie).expect(200);
    });
  });
});
