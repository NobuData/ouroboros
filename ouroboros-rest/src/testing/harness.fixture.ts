/**
 * The application under test: a real Nest, on a real socket, over a real database.
 *
 * The second half of [#37](https://github.com/NobuData/ouroboros/issues/37).
 * `postgres.fixture.ts` produces a migrated PostgreSQL; this produces the four things a
 * suite needs on top of it, and each of them is a decision rather than a convenience:
 *
 *   * **A listening server on a random port.** `app.init()` is enough for Supertest, which
 *     binds an ephemeral port of its own per request — but "the service answers on the port
 *     it was given" is then a claim nothing checks, and neither is anything about
 *     `listen()`. This calls `listen(0)`, so every request in every suite crosses a socket
 *     the application opened. Port `0` because two suites must be able to run without
 *     agreeing on a number, and because a developer's `yarn dev` on 4000 must not collide
 *     with a test run.
 *   * **A connection of the suite's own.** Arranging a fixture through the API under test
 *     makes the arrangement part of what is being asserted; a member with a `viewer` role
 *     cannot be created over an API that only lets an administrator create one. {@link sql}
 *     is a second pool, outside the application, for exactly the setup and the assertions
 *     the application must not be asked to perform.
 *   * **Truncation between tests.** Prefix-scoped cleanup was what the first suites used, and
 *     it only works while every row a test creates is named by that test. The moment a
 *     fixture creates a row the suite did not name — a membership, an identity, an
 *     organisation — the cleanup leaks. {@link ApiHarness.truncate} empties every table the
 *     migrations created, so what a suite sees is what it put there.
 *   * **Sessions minted the way a sign-in mints them.** {@link ApiHarness.signIn} inserts a
 *     real `ouroboros."user"` row and then a real `session` row, and hands back the cookie
 *     that names it. Nothing here is a bypass: a suite using it exercises the global guard
 *     rather than avoiding it, which is the difference between proving the tenancy API
 *     works for a signed-in caller and proving nothing because authentication was switched
 *     off underneath it. Since
 *     [#703](https://github.com/NobuData/ouroboros/issues/703) it also means a suite can
 *     *revoke* one and watch the same cookie stop working.
 *
 * ```ts
 * let api: ApiHarness;
 *
 * beforeAll(async () => { api = await ApiHarness.start(); });
 * afterAll(() => api.close());
 * afterEach(() => api.truncate());
 *
 * it("answers", async () => {
 *   const owner = await api.signIn();
 *   const workspace = await api.workspace(owner);
 *
 *   await api.as(owner)("get", `/api/v1/orgs/${workspace.id}/domains`).expect(200);
 * });
 * ```
 *
 * **Every people-shaped fixture writes the library's tables, and only those.**
 * [#714](https://github.com/NobuData/ouroboros/issues/714) is where that became true: V006
 * dropped `users` and `tenant_members`, so {@link ApiHarness.signIn} writes `"user"` and
 * {@link ApiHarness.join} writes `member`. Both are `LIBRARY_OWNED_TABLES` and the
 * application may not write them — a *fixture* arranging a row through the suite's own
 * connection is a different act from application code doing it, and it is the only way to
 * stand up the `member` and `viewer` roles the role matrix has to refuse.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import request from "supertest";

import { createApplication } from "../application";
import { AUTH_BASE_PATH } from "../auth/auth.options";
import { GITHUB_PROVIDER_ID } from "../auth/github.provider";
import { signInAs } from "../modules/auth/session.fixture";
import type { Configuration } from "../modules/config/configuration";
import { testConfiguration } from "../modules/config/configuration.fixture";
import { SCHEMA_NAME, type OrganizationRole } from "../modules/db/schema";
import type { GithubStub } from "./github.fixture";
import {
  cookiesOf,
  databaseIsDisposable,
  DISPOSABLE,
  integrationDatabaseUrl,
  IS_DISPOSABLE,
  uniqueEmail,
  uniqueName,
} from "./integration.fixture";

/** The verbs this API answers to, which is every verb a suite has to be able to send. */
export type Method = "get" | "post" | "patch" | "delete";

/** Somebody signed in: the person, and the cookie their browser carries. */
export interface Person {
  /**
   * Their id — `ouroboros."user".id`, which is also what `member."userId"` holds.
   *
   * One value in one table since #714. It was one value in *two* until V006 dropped
   * `ouroboros.users`, which is why the harness used to write both.
   */
  readonly id: string;
  /** Their address, folded to lower case exactly as the API would fold it. */
  readonly email: string;
  /** What a member list shows. */
  readonly displayName: string;
  /** The `Cookie` header value, ready for Supertest's `.set("Cookie", …)`. */
  readonly cookie: string;
}

/** A request builder that already carries somebody's session. */
export type SignedIn = (method: Method, path: string) => request.Test;

/**
 * The namespace every row the harness invents is named inside.
 *
 * A suite may still name its own rows whatever it likes; this is only what
 * {@link ApiHarness.signIn} and {@link ApiHarness.workspace} reach for when they are not
 * told. It is shaped to fit `github_orgs_login_format`, which admits only lower-case
 * alphanumerics in single-hyphen-separated groups — the strictest rule any of these fixtures
 * has to satisfy, so one prefix serves every one of them.
 */
export const HARNESS_PREFIX = "ouro-h";

/** The tenancy API's base path, which is where most of what the harness does lands. */
export const ORGS = "/api/v1/orgs";

/**
 * BetterAuth's own base path, restated as the harness writes it.
 *
 * From `auth.options.ts` rather than typed again, because a suite asserting that a route is
 * served *where the service says it is* and a suite that hard-codes the same string are
 * different tests, and only the first one is worth having.
 */
export const AUTH = AUTH_BASE_PATH;

/**
 * The password every account {@link ApiHarness.signUp} creates is given.
 *
 * Twenty-one characters, comfortably past `PASSWORD_MIN_LENGTH` — which is twelve, and which
 * `password.provider.ts` says #709's seeded credentials also have to clear. It is a constant
 * rather than a random string so that a suite asserting a *wrong* password has something to
 * be wrong about.
 */
export const HARNESS_PASSWORD = "harness-password-0001";

/** A workspace, as the harness stands one up. */
export interface Workspace {
  /** `organization."id"` — the `{orgId}` every tenancy route takes. */
  readonly id: string;
  /** Its handle. */
  readonly slug: string;
  /** What a human reads, and what the Step 2 monogram is derived from. */
  readonly name: string;
}

/**
 * Flyway's own table, which is in the application's schema and is not the application's.
 *
 * `flyway.toml` records history in the schema it migrates, so it turns up in the same
 * catalogue query the tables do. Truncating it would leave a database that is migrated and
 * says it is not — which the next `flyway migrate` would try to fix by applying V000 to a
 * schema that already has it.
 */
const HISTORY_TABLE = "flyway_schema_history";

export class ApiHarness {
  /** Every table {@link truncate} empties, discovered once and remembered. */
  private tables: string[] | undefined;

  /**
   * What each person's browser is holding — see {@link as}.
   *
   * A `WeakMap` keyed by the {@link Person} object rather than by their id, because one
   * account can have two browsers and each is its own jar. It also means a person a test
   * created goes away with the test.
   */
  private readonly jars = new WeakMap<Person, string>();

  /**
   * @param app - The application, already listening.
   * @param baseUrl - Where it is listening, as a Supertest base.
   * @param configuration - What it was configured with, for a suite that needs to assert
   *   against a value the application was given.
   * @param sql - The suite's own connection, outside the application.
   */
  private constructor(
    private readonly app: INestApplication,
    readonly baseUrl: string,
    readonly configuration: Configuration,
    readonly sql: Pool,
  ) {}

  /**
   * Build the application the process builds, and listen.
   *
   * `createApplication` rather than `@nestjs/testing`, deliberately: this is the whole
   * pipeline — the global prefix, the versioning, the validation pipe, the error filter, the
   * authentication guard, the tenant guard and the roles guard, in that order — and a suite that
   * assembled its own would be asserting against a copy of the real one that is free to
   * drift from it. A suite that has to *replace* a provider is the exception and builds its
   * own; `auth.integration-spec.ts` is the one that does, because github.com is not
   * available to it.
   *
   * @param overrides - Environment variables to change before the configuration is
   *   validated. `OURO_DATABASE_URL` is already set to the run's database and can be
   *   overridden like anything else.
   * @returns The started harness.
   * @throws {Error} When no database was published — see `integrationDatabaseUrl`.
   */
  static async start(overrides: NodeJS.ProcessEnv = {}): Promise<ApiHarness> {
    const configuration = testConfiguration({
      OURO_DATABASE_URL: integrationDatabaseUrl(),
      ...overrides,
    });

    const app = await createApplication(configuration, { logger: false });
    // Loopback rather than every interface: a test server is not something another machine
    // on the network should be able to reach, and binding it there would be a difference
    // between this and the process that nothing needs.
    await app.listen(0, "127.0.0.1");

    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
    const sql = new Pool({ connectionString: configuration.databaseUrl, max: 2 });

    return new ApiHarness(app, `http://127.0.0.1:${port}`, configuration, sql);
  }

  /** The port the operating system chose. */
  get port(): number {
    return ((this.app.getHttpServer() as Server).address() as AddressInfo).port;
  }

  /**
   * The application itself, for the one thing that cannot be asked over HTTP.
   *
   * Exposed by [#715](https://github.com/NobuData/ouroboros/issues/715) for
   * `guard.surface.integration-spec.ts`, which enumerates the **route table** — every
   * controller Nest registered and the exemption metadata on each handler. There is no
   * request that answers "what routes exist"; only the injector knows.
   *
   * It is a narrow door and meant to stay one. A suite reaching in here to replace a provider
   * or call a service directly would be testing the object rather than the service, which is
   * what every other method on this harness exists to avoid.
   */
  get nest(): INestApplication {
    return this.app;
  }

  /**
   * A request from a browser with no session.
   *
   * @param method - The verb.
   * @param path - The path, from the origin root — so `/api/v1/…` for the API and
   *   `/health/live` for a probe, exactly as a client writes them.
   * @returns The Supertest request.
   */
  anonymous(method: Method, path: string): request.Test {
    return request(this.baseUrl)[method](path);
  }

  /**
   * A request from somebody's browser.
   *
   * Returns the builder rather than taking the whole request, so a suite can bind it once —
   * `const owner = api.as(person)` — and every call after that carries the session by
   * construction rather than by being remembered at fifty call sites.
   *
   * **It keeps the cookies it is given**, which is the part
   * [#715](https://github.com/NobuData/ouroboros/issues/715) added and the part that makes
   * this a browser rather than a fixed header. Two cookies matter and only one of them is
   * static: the session token, which does not change, and the *cookie cache*
   * (`SESSION_COOKIE_CACHE_SECONDS`), a signed snapshot of the session that BetterAuth
   * re-issues whenever it changes. `POST /api/auth/organization/set-active` is what makes
   * that concrete — it moves `session."activeOrganizationId"` and hands back a fresh
   * snapshot, and a caller that went on replaying the old one would keep acting in the
   * workspace it had just left, for up to five minutes, with every assertion about the switch
   * quietly failing.
   *
   * The jar is per-{@link Person} *object*, so `signInWithPassword`'s new person is a second
   * browser rather than the same one — which is what makes "sign out here and stay signed in
   * there" arrangeable.
   *
   * @param person - Whose session, from {@link signIn}, {@link signUp} or
   *   {@link signInWithPassword}.
   * @returns A builder that sends their current cookies and stores whatever comes back.
   */
  as(person: Person): SignedIn {
    return (method, path) => {
      const pending = this.anonymous(method, path).set("Cookie", this.jarFor(person));

      pending.on("response", (response: request.Response) => {
        this.keepCookies(person, response);
      });

      return pending;
    };
  }

  /**
   * What this person's browser is currently holding.
   *
   * @param person - Whose jar.
   * @returns The `Cookie` header value — their sign-in's cookies until something replaces one.
   */
  jarFor(person: Person): string {
    return this.jars.get(person) ?? person.cookie;
  }

  /**
   * Store whatever a response set, the way a browser would.
   *
   * A cookie the response did not mention is left alone, and one it *removed* — `Max-Age=0`
   * with an empty value, which is how signing out clears them — is dropped rather than
   * carried forward empty. That second rule is what makes a post-sign-out request from the
   * same browser genuinely anonymous, instead of one presenting `name=` and being refused for
   * the wrong reason.
   *
   * @param person - Whose jar.
   * @param response - What came back.
   */
  private keepCookies(person: Person, response: request.Response): void {
    const set = (response.headers["set-cookie"] ?? []) as unknown as string[];

    if (set.length === 0) {
      return;
    }

    const jar = new Map<string, string>();

    for (const pair of this.jarFor(person).split("; ").filter(Boolean)) {
      jar.set(pair.slice(0, pair.indexOf("=")), pair);
    }

    for (const header of set) {
      const pair = header.split(";")[0];
      const name = pair.slice(0, pair.indexOf("="));

      if (pair === `${name}=`) {
        jar.delete(name);
      } else {
        jar.set(name, pair);
      }
    }

    this.jars.set(person, [...jar.values()].join("; "));
  }

  /**
   * Create somebody, and sign them in.
   *
   * The row is inserted directly rather than through a sign-in, because the providers that
   * would create one need GitHub (#702) or a scrypt hash (#705) and neither is a thing every
   * suite should have to arrange to have *a person*. One table: `ouroboros."user"`, which is
   * what the session references and what `member."userId"` names.
   *
   * `emailVerified` is true, which is the state a completed sign-in leaves — GitHub only
   * completes with a verified primary address, and the credential provider verifies on
   * registration.
   *
   * @param overrides - Their address and name, when a suite cares what they are.
   * @returns Them, with the cookie their browser carries.
   */
  async signIn(overrides: Partial<Pick<Person, "email" | "displayName">> = {}): Promise<Person> {
    const email = (overrides.email ?? uniqueEmail(HARNESS_PREFIX)).toLowerCase();
    const displayName = overrides.displayName ?? "Harness Person";

    const { rows } = await this.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}."user" ("id", "name", "email", "emailVerified", "updatedAt")
       values (gen_random_uuid()::text, $1, $2, true, now())
       on conflict ("email") do update set "name" = excluded."name"
       returning "id"`,
      [displayName, email],
    );

    return { id: rows[0].id, email, displayName, cookie: await this.session(rows[0].id) };
  }

  /**
   * Create somebody by **signing them up**, the way a browser would.
   *
   * The difference from {@link signIn} is the whole of why
   * [#715](https://github.com/NobuData/ouroboros/issues/715) added it. {@link signIn} inserts
   * two rows and composes a cookie: fast, and enough for a suite whose subject is somewhere
   * else. This one posts to `POST /api/auth/sign-up/email` and gets back whatever the library
   * decides to do — a scrypt hash in `account.password`, a `session` row, the signed cookie,
   * and [#704](https://github.com/NobuData/ouroboros/issues/704)'s session hook creating a
   * personal organization and pointing the session at it. Nothing here is arranged; it is all
   * consequence.
   *
   * It works because `NODE_ENV` is not `production` in these suites, which is the one switch
   * `password.provider.ts` gates the route on. A harness started with
   * `{ NODE_ENV: "production" }` gets a `400` from this, and `credentials.integration-spec.ts`
   * is where that is asserted rather than worked around.
   *
   * @param overrides - Their address, name and password, when a suite cares what they are.
   * @returns Them, with the cookie the sign-up handed back.
   * @throws {Error} When the library refused the sign-up, naming what it said — a suite
   *   whose arrangement failed should not go on to report a confusing assertion failure.
   */
  async signUp(
    overrides: Partial<Pick<Person, "email" | "displayName">> & { password?: string } = {},
  ): Promise<Person> {
    const email = (overrides.email ?? uniqueEmail(HARNESS_PREFIX)).toLowerCase();
    const displayName = overrides.displayName ?? "Harness Person";
    const response = await this.anonymous("post", `${AUTH}/sign-up/email`).send({
      email,
      name: displayName,
      password: overrides.password ?? HARNESS_PASSWORD,
    });

    if (response.status !== 200) {
      throw new Error(
        `Signing ${email} up answered ${response.status}: ${JSON.stringify(response.body)}`,
      );
    }

    const { user } = response.body as { user: { id: string } };

    return { id: user.id, email, displayName, cookie: cookiesOf(response) };
  }

  /**
   * Sign somebody in with their password.
   *
   * The route #705 added, and the one an e2e run and a developer both use. A wrong password
   * is a `401` from the library rather than an exception here, so a suite asserting refusal
   * calls `anonymous` directly; this is for the arrangement, and it throws on anything but a
   * completed sign-in for the reason {@link signUp} does.
   *
   * @param person - Who. Their `email` and `displayName` are carried through to the result,
   *   because the answer only names the id.
   * @param password - What they type. Defaults to {@link HARNESS_PASSWORD}.
   * @returns Them, with the cookie of the **new** session — a second one, if they already
   *   had one, exactly as signing in on a second machine would be.
   * @throws {Error} When the sign-in did not complete.
   */
  async signInWithPassword(person: Person, password: string = HARNESS_PASSWORD): Promise<Person> {
    const response = await this.anonymous("post", `${AUTH}/sign-in/email`).send({
      email: person.email,
      password,
    });

    if (response.status !== 200) {
      throw new Error(
        `Signing ${person.email} in answered ${response.status}: ${JSON.stringify(response.body)}`,
      );
    }

    return { ...person, cookie: cookiesOf(response) };
  }

  /**
   * Walk the whole GitHub handshake, against a stubbed github.com.
   *
   * Both hops, because the `state` the second one presents is the one the first one issued —
   * that pairing is a cross-site-request-forgery defence, it lives in a cookie, and a suite
   * that skipped the first hop would be asserting against a callback with the check disabled.
   *
   *   1. `POST /api/auth/sign-in/social` answers the github.com authorization URL and sets
   *      the state cookies. The `code_challenge`, the scopes and the redirect are all in that
   *      URL and are the provider's decisions, which `github.integration-spec.ts` reads.
   *   2. `GET /api/auth/callback/github?code=…&state=…` presents those cookies back. The
   *      library exchanges the code and reads the profile — both through
   *      `src/testing/github.fixture.ts` — and answers a redirect with the session cookie.
   *
   * @param github - The installed stub, from `stubGithub`. Its recorded calls are how a suite
   *   asserts what was sent to github.com.
   * @param code - The authorization code github.com would have redirected with. Any string;
   *   the stub does not check it, and the exchange records it.
   * @returns The browser's `Cookie` header after the callback, and where it was redirected.
   *   Not a {@link Person}: who signed in is a *result* of this flow rather than an input,
   *   and a suite reads it from `GET /api/auth/get-session`.
   */
  async signInWithGithub(
    github: GithubStub,
    code = "stubbed-authorization-code",
  ): Promise<{ cookie: string; location: string; status: number }> {
    const begun = await this.anonymous("post", `${AUTH}/sign-in/social`).send({
      provider: GITHUB_PROVIDER_ID,
      callbackURL: "/",
    });

    if (begun.status !== 200) {
      throw new Error(
        `Beginning a GitHub sign-in answered ${begun.status}: ${JSON.stringify(begun.body)}`,
      );
    }

    const { url } = begun.body as { url: string };
    const state = new URL(url).searchParams.get("state") ?? "";

    const exchangesBefore = github.exchanges.length;

    const callback = await this.anonymous(
      "get",
      `${AUTH}/callback/${GITHUB_PROVIDER_ID}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    )
      // The state cookies the first hop set. Without them the callback has nothing to compare
      // the `state` parameter against and refuses — which is the library working, not a bug.
      .set("Cookie", cookiesOf(begun))
      .redirects(0);

    // The stub is the reason this suite reaches no network, so "the code was exchanged
    // through it" is worth asserting *here* rather than leaving to whatever the caller
    // happens to check. A suite that forgot `stubGithub` would otherwise fail somewhere far
    // downstream, on a `fetch` to the real github.com that timed out or — worse — did not.
    if (github.exchanges.length !== exchangesBefore + 1) {
      throw new Error(
        "The GitHub callback exchanged no code through the stub. Either `stubGithub` was not " +
          "installed before this call, or the callback was refused before it got that far — " +
          `it answered ${callback.status} ${String(callback.headers.location ?? "")}.`,
      );
    }

    return {
      cookie: cookiesOf(callback),
      location: String(callback.headers.location ?? ""),
      status: callback.status,
    };
  }

  /**
   * Give an existing person a second session.
   *
   * Two browsers, one account — which is the arrangement every revocation assertion needs:
   * sign out of one and the other must be unaffected, because sign-out deletes *a* session
   * row rather than everybody's.
   *
   * @param userId - Whose. A `"user".id` from {@link signIn}.
   * @param lifetimeSeconds - How long it lasts. Defaults to the fixture's hour; a negative
   *   value mints one that has already expired, which is how "the guard reads the row
   *   rather than the cookie" is asserted.
   * @returns The `Cookie` header value for the new session.
   */
  async session(userId: string, lifetimeSeconds?: number): Promise<string> {
    return signInAs(this.sql, userId, {
      // The secret the application under test was configured with, so the cookie this
      // mints is one it will accept. Since #715 the real library verifies the signature —
      // see `signSessionToken` — and a harness that reached for the *default* secret would
      // hand out `401`s the moment a suite overrode it in `start`.
      secret: this.configuration.betterAuthSecret,
      ...(lifetimeSeconds === undefined ? {} : { lifetimeSeconds }),
    });
  }

  /**
   * Give somebody a role in a workspace, directly.
   *
   * Directly, because the point of most of these fixtures is to have a `member` or a `viewer`
   * to make a request as — and this service has no route that creates one at all since
   * [#714](https://github.com/NobuData/ouroboros/issues/714): membership is the organization
   * plugin's, whose `addMember` needs an inviter and an acceptance a suite has no reason to
   * stage. `member` is one of `LIBRARY_OWNED_TABLES`, and this is the suite's own connection
   * rather than the application's — see this file's header on why that distinction holds.
   *
   * @param organizationId - The workspace.
   * @param person - Who joins it.
   * @param role - What they hold there. A single word; the column takes a comma-separated
   *   list and `rolesFrom` parses one, which `roles.integration-spec.ts` exercises directly.
   * @returns When the membership exists.
   */
  async join(organizationId: string, person: Person, role: OrganizationRole): Promise<void> {
    await this.sql.query(
      `insert into ${SCHEMA_NAME}.member ("id", "organizationId", "userId", "role", "createdAt")
       values (gen_random_uuid()::text, $1, $2, $3, now())`,
      [organizationId, person.id, role],
    );
  }

  /**
   * Create a workspace, owned by somebody.
   *
   * Directly rather than over the API, and that is a change #714 forced rather than chose:
   * `POST /api/v1/tenants` used to create the row *and* the owner membership in one service
   * call, and that route is gone — creating a workspace is
   * `POST /api/auth/organization/create`, which BetterAuth serves and which needs the whole
   * plugin standing behind it. Two statements here reproduce exactly what it does: the
   * organization, and the caller as its `owner`.
   *
   * The membership is not optional. A workspace with no members answers `404` to every route
   * under it — including its creator's — because that is the rule `tenant.resolver.ts`
   * enforces, so a fixture that inserted only the first row would produce a workspace nobody
   * can use.
   *
   * @param owner - Who owns it.
   * @param slug - Its slug. Invented inside the harness namespace when not given.
   * @param name - What a human reads. Two words, so {@link ORGS}'s monogram has initials to
   *   take.
   * @returns The workspace.
   */
  async workspace(
    owner: Person,
    slug: string = uniqueName(HARNESS_PREFIX),
    name = "Harness Workspace",
  ): Promise<Workspace> {
    const { rows } = await this.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.organization ("id", "name", "slug", "createdAt")
       values (gen_random_uuid()::text, $1, $2, now())
       returning "id"`,
      [name, slug],
    );

    await this.join(rows[0].id, owner, "owner");

    return { id: rows[0].id, slug, name };
  }

  /**
   * Empty every table the migrations created.
   *
   * `restart identity` because a sequence that survived would make a suite's identifiers
   * depend on how many suites ran before it, and `cascade` because the tables reference each
   * other — without it, truncating `tenants` fails naming `tenant_domains` rather than
   * emptying both.
   *
   * The list is read from the catalogue rather than from `TABLE_NAMES` in `db/schema.ts`. The
   * two are checked against each other by `db.integration-spec.ts`, and if they ever
   * disagree it is this one that has to win: a table the migrations created and the mirror
   * does not name is exactly the row a suite would otherwise inherit.
   *
   * **It refuses a database it was handed.** This is the one thing the harness does that a
   * developer can lose work to, so it is gated on the database having been declared
   * disposable — see `databaseIsDisposable`, which is where the reason is written down.
   *
   * @returns When the database is empty.
   * @throws {Error} When the database was not declared disposable, or when there are no
   *   tables at all — which means the migrations did not run.
   */
  async truncate(): Promise<void> {
    if (!databaseIsDisposable()) {
      throw new Error(
        `Refusing to empty a database this run did not start. Unset OURO_DATABASE_URL to ` +
          `let the harness start its own, or set ${DISPOSABLE}=${IS_DISPOSABLE} if the one ` +
          "you supplied is genuinely throwaway — truncation takes the development seed with " +
          "everything else.",
      );
    }

    this.tables ??= await this.discoverTables();

    await this.sql.query(`truncate table ${this.tables.join(", ")} restart identity cascade`);
  }

  /**
   * Stop listening and give every connection back.
   *
   * Both, in this order: the application drains its own pool through the shutdown hook
   * `createApplication` enabled, and the suite's connection is not the application's to
   * close. Leaving either open leaves Jest with an open handle and a run that does not end.
   *
   * @returns When nothing this harness opened is still open.
   */
  async close(): Promise<void> {
    await this.app.close();
    await this.sql.end();
  }

  /**
   * Every table in the application's schema, quoted, except Flyway's own.
   *
   * `format('%I.%I')` is PostgreSQL quoting its own identifiers, which is what makes it safe
   * to interpolate the result into the `truncate` above — the names come from the catalogue
   * and go back to the server escaped by the server.
   *
   * @returns The qualified, quoted table names.
   * @throws {Error} When the schema holds no tables.
   */
  private async discoverTables(): Promise<string[]> {
    const { rows } = await this.sql.query<{ table: string }>(
      `select format('%I.%I', schemaname, tablename) as table
         from pg_catalog.pg_tables
        where schemaname = $1 and tablename <> $2
        order by tablename`,
      [SCHEMA_NAME, HISTORY_TABLE],
    );

    if (rows.length === 0) {
      throw new Error(
        `No tables in the ${SCHEMA_NAME} schema. The database this run was given has not ` +
          "been migrated — see src/testing/postgres.fixture.ts.",
      );
    }

    return rows.map((row) => row.table);
  }
}
