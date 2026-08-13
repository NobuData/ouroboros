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
import { signInAs } from "../modules/auth/session.fixture";
import type { Configuration } from "../modules/config/configuration";
import { testConfiguration } from "../modules/config/configuration.fixture";
import { SCHEMA_NAME, type OrganizationRole } from "../modules/db/schema";
import {
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
   * @param person - Whose session, from {@link signIn}.
   * @returns A builder that sets their `Cookie` on every request it makes.
   */
  as(person: Person): SignedIn {
    return (method, path) => this.anonymous(method, path).set("Cookie", person.cookie);
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
   * Give an existing person a second session.
   *
   * Two browsers, one account — which is the arrangement every revocation assertion needs:
   * sign out of one and the other must be unaffected, because sign-out deletes *a* session
   * row rather than everybody's.
   *
   * @param userId - Whose. A `"user".id` from {@link signIn}.
   * @returns The `Cookie` header value for the new session.
   */
  async session(userId: string): Promise<string> {
    return signInAs(this.sql, userId);
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
