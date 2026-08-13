import { Injectable, type LoggerService } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { sql, type Transaction } from "kysely";
import { Pool } from "pg";

import { integrationDatabaseUrl } from "../../testing/integration.fixture";
import { SERVICE_NAME } from "../../version";
import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DbModule } from "./db.module";
import { DatabaseService } from "./db.service";
import { SCHEMA_NAME, TABLE_COLUMNS, TABLE_NAMES, type Database, type GithubOrg } from "./schema";

/**
 * The half of this module that needs a real PostgreSQL.
 *
 * > *A repository roundtrip against the [#10](https://github.com/NobuData/ouroboros/issues/10)
 * > database works in an integration test.*
 * > *Clean pool drain on `SIGTERM`.*
 *
 * Everything in `*.spec.ts` beside this file is checked without a database, because a unit
 * suite that starts one is a unit suite nobody runs on save. What is left over is
 * everything that is only true of a *migrated* database: that the columns this module
 * declares are the columns Flyway created, that a row written through the typed builder
 * comes back with the types the interface promises, that a transaction really rolls back,
 * and that shutting the application down really returns the connections.
 *
 * ```bash
 * yarn test:integration
 * ```
 *
 * Since [#37](https://github.com/NobuData/ouroboros/issues/37) the database comes from the
 * harness — a `postgres:17-alpine` started for the run and migrated with `ouroboros-db`'s
 * own Flyway project — so the command above needs nothing but Docker. It still writes to
 * whatever database it is given: every row it creates is named with {@link TEST_PREFIX} and
 * removed afterwards, so exporting `OURO_DATABASE_URL` to point it at the development
 * stack — which already carries the dev seed — remains safe, and touches nothing that was
 * there before it ran. Do not point it at anything else.
 */

/**
 * The database this suite runs against.
 *
 * There is no default and no skip. A suite that quietly passes when it was given no
 * database is a suite that reports "the schema matches" having compared nothing, and this
 * is the only check in the repository that can catch the types drifting from the
 * migrations.
 */
const DATABASE_URL = integrationDatabaseUrl();

/**
 * What every row this suite creates is named with.
 *
 * Slugs and logins are constrained to lower-case alphanumerics and single hyphens by the
 * migrations, so the prefix is shaped to fit those rules rather than made readable.
 */
const TEST_PREFIX = "ouro-it";

/** How long the drain check waits for PostgreSQL to notice a connection has gone. */
const DRAIN_TIMEOUT_MS = 5_000;

/**
 * A repository, written the way `DbModule` says a feature module should write one.
 *
 * It lives here rather than in `src/modules/` because it is the *convention* demonstrated and
 * exercised rather than a shipping repository — `modules/tenancy/enablement.repository.ts` is
 * the real one over these two tables. Everything about it is what a feature module's looks
 * like: it injects {@link DatabaseService}, it names no environment variable, it opens no
 * connection, and it takes an optional transaction so the same method can be called inside
 * one or outside it.
 *
 * It works `github_orgs` rather than `tenants` because
 * [#708](https://github.com/NobuData/ouroboros/issues/708) dropped the latter. The choice of
 * replacement is not arbitrary: this has to be a table *this repository owns and writes*, and
 * of the five left in the mirror, `organization` and `member` are the library's and are
 * read-only here. `github_orgs` also keeps every property the old example was chosen for — a
 * generated uuid, a defaulted flag, an `updated_at` trigger, a `check` the types cannot
 * express, and a foreign key in each direction.
 */
@Injectable()
class GithubOrgsRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Record a GitHub organisation against a workspace.
   *
   * @param organizationId - The owning workspace, as `organization."id"`.
   * @param login - The lower-cased GitHub login. Unique within the workspace.
   * @param trx - The transaction to run in, if there is one.
   * @returns The row as the database stored it, defaults and all.
   */
  async create(
    organizationId: string,
    login: string,
    trx?: Transaction<Database>,
  ): Promise<GithubOrg> {
    return (trx ?? this.database.db)
      .insertInto("github_orgs")
      .values({ organization_id: organizationId, login })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Find one by its login.
   *
   * @param login - The login to look up. Unique per workspace, and this suite's logins are
   *   unique across the installation by construction — see {@link uniqueName}.
   * @param trx - The transaction to run in, if there is one.
   * @returns The row, or `undefined` when there is none.
   */
  async findByLogin(login: string, trx?: Transaction<Database>): Promise<GithubOrg | undefined> {
    return (trx ?? this.database.db)
      .selectFrom("github_orgs")
      .selectAll()
      .where("login", "=", login)
      .executeTakeFirst();
  }

  /**
   * Turn one on or off.
   *
   * @param login - The organisation to change.
   * @param enabled - What the flag should become.
   * @returns The updated row.
   */
  async setEnabled(login: string, enabled: boolean): Promise<GithubOrg> {
    return this.database.db
      .updateTable("github_orgs")
      .set({ enabled })
      .where("login", "=", login)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}

/**
 * A connection this suite owns, independent of the service's pool.
 *
 * The drain check has to be able to ask PostgreSQL about the pool *after* the pool is gone,
 * and the cleanup has to run after the application is closed, so neither can go through
 * the thing under test.
 */
const admin = new Pool({ connectionString: DATABASE_URL, max: 1 });

/** A slug or login no other run of this suite will produce. */
function uniqueName(): string {
  return `${TEST_PREFIX}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Create the workspace every row below hangs from.
 *
 * Written through {@link admin} as raw SQL rather than through the typed builder, and that is
 * the rule rather than a shortcut: `organization` is one of `LIBRARY_OWNED_TABLES`, BetterAuth
 * is the only thing that writes it in the running service, and a suite that inserted through
 * Kysely would be demonstrating the one thing `db/schema.ts` forbids. Test *setup* standing up
 * a parent row is a different act from application code writing one.
 *
 * `id` and `createdAt` are supplied because V005 gives neither a default — the library always
 * sends both.
 *
 * @returns The new workspace's id.
 */
async function createWorkspace(): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into ouroboros.organization ("id", "name", "slug", "createdAt")
     values (gen_random_uuid()::text, 'Integration Suite', $1, now())
     returning "id"`,
    [uniqueName()],
  );

  return rows[0].id;
}

/**
 * Remove everything this suite created.
 *
 * One statement, because `github_orgs_organization_id_fkey` and `github_repos_org_id_fkey`
 * both cascade — deleting the workspace takes its organisations and their repositories with
 * it, which is the same cascade V006 restated when it re-parented the tables.
 */
async function removeTestRows(): Promise<void> {
  await admin.query(`delete from ouroboros.organization where "slug" like $1`, [
    `${TEST_PREFIX}-%`,
  ]);
}

/**
 * A logger that says nothing.
 *
 * Two tests below provoke a real constraint violation on purpose, and `DatabaseService`
 * reports the failed query the way it is supposed to — with `pg`'s own diagnosis and its
 * stack. That behaviour is asserted in `logging.spec.ts`; printing it here would bury the
 * suite's output under stack traces from the failures it went looking for.
 *
 * Installed through `setLogger` rather than `Logger.overrideLogger`, because
 * `Test.createTestingModule().compile()` installs a logger of its own and would undo it.
 */
const silent: LoggerService = {
  log: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  verbose: () => undefined,
  fatal: () => undefined,
};

/**
 * Build an application holding a real connection to the database.
 *
 * @returns The Nest testing module. `close()` on it is what runs the shutdown hooks.
 */
async function application(): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      ConfigurationModule.forRoot(testConfiguration({ OURO_DATABASE_URL: DATABASE_URL })),
      DbModule,
    ],
  })
    .setLogger(silent)
    .compile();
}

/**
 * How many connections this service currently holds on the server.
 *
 * Read from `pg_stat_activity` by `application_name`, which `pool.ts` sets — so this counts
 * exactly the request pool's connections and none of the readiness probe's, which names
 * itself differently.
 *
 * @returns The number of backends PostgreSQL attributes to this service.
 */
async function serviceConnections(): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from pg_stat_activity where application_name = $1",
    [SERVICE_NAME],
  );

  return Number(rows[0].count);
}

/**
 * Wait for the service's connection count to come back to where it started.
 *
 * A closed socket is not instantaneous from the server's side, so this polls rather than
 * asserting once — the alternative is a sleep long enough to be safe, which is a slower
 * suite that is still occasionally wrong.
 *
 * @param baseline - The count before the application under test was built.
 * @returns The count once it has settled, or the last count read before the deadline.
 */
async function drainedTo(baseline: number): Promise<number> {
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  let count = await serviceConnections();

  while (count > baseline && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    count = await serviceConnections();
  }

  return count;
}

describe("the database, for real", () => {
  let moduleRef: TestingModule;
  let database: DatabaseService;
  let orgs: GithubOrgsRepository;
  let workspaceId: string;

  beforeAll(async () => {
    moduleRef = await application();
    database = moduleRef.get(DatabaseService);
    orgs = new GithubOrgsRepository(database);
  });

  afterAll(async () => {
    // Ordered: the application's own pool first, then the connection the cleanup needs.
    await moduleRef.close();
    await removeTestRows();
    await admin.end();
  });

  beforeEach(async () => {
    workspaceId = await createWorkspace();
  });

  afterEach(removeTestRows);

  describe("a repository roundtrip", () => {
    it("writes a row and reads it back", async () => {
      const login = uniqueName();

      const created = await orgs.create(workspaceId, login);
      const found = await orgs.findByLogin(login);

      expect(found).toEqual(created);
      expect(found?.login).toBe(login);
      expect(found?.organization_id).toBe(workspaceId);
    });

    it("comes back with the types the interface promises", async () => {
      const created = await orgs.create(workspaceId, uniqueName());

      // The defaults V003 declares, as the types say they arrive: a uuid as a string, a
      // timestamptz as a Date, and the flag that fails closed.
      expect(typeof created.id).toBe("string");
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.enabled).toBe(false);
      expect(created.installed_at).toBeNull();
      expect(created.created_at).toBeInstanceOf(Date);
      expect(created.updated_at).toBeInstanceOf(Date);
    });

    it("lets the database keep updated_at, as its trigger does", async () => {
      const login = uniqueName();
      const created = await orgs.create(workspaceId, login);

      const enabled = await orgs.setEnabled(login, true);

      // `ouroboros.touch_updated_at()` stamps this from the server clock. Nothing in the
      // update said so — which is why the type does not offer the column.
      expect(enabled.enabled).toBe(true);
      expect(enabled.updated_at.getTime()).toBeGreaterThanOrEqual(created.updated_at.getTime());
      expect(enabled.created_at).toEqual(created.created_at);
    });

    it("follows a foreign key back to its parent", async () => {
      // The hop V006 re-pointed. `github_orgs.organization_id` is text holding a uuid and
      // `organization."id"` is text, which is what made the migration a rename rather than a
      // remapping — and a join is where that either works or does not.
      const login = uniqueName();
      await orgs.create(workspaceId, login);

      const rows = await database.db
        .selectFrom("github_orgs")
        .innerJoin("organization", "organization.id", "github_orgs.organization_id")
        .select(["organization.name", "github_orgs.login", "github_orgs.enabled"])
        .where("github_orgs.organization_id", "=", workspaceId)
        .execute();

      expect(rows).toEqual([{ name: "Integration Suite", login, enabled: false }]);
    });

    it("lets the schema refuse what it is supposed to refuse", async () => {
      // The types cannot express `github_orgs_login_format`, and are not meant to: the
      // database is the one that enforces it. What matters is that the violation arrives as a
      // rejected promise a repository can map to a 4xx rather than as a silent write.
      await expect(orgs.create(workspaceId, "Not A Login")).rejects.toThrow();
    });
  });

  describe("a transaction", () => {
    it("commits everything when the work succeeds", async () => {
      const login = uniqueName();

      await database.transaction(async (trx) => {
        const org = await orgs.create(workspaceId, login, trx);
        await trx.insertInto("github_repos").values({ org_id: org.id, name: "helios" }).execute();
      });

      const repos = await database.db
        .selectFrom("github_repos")
        .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
        .select("github_repos.name")
        .where("github_orgs.login", "=", login)
        .execute();
      expect(repos).toEqual([{ name: "helios" }]);
    });

    it("rolls everything back when the work throws", async () => {
      const login = uniqueName();
      const failure = new Error("changed my mind");

      await expect(
        database.transaction(async (trx) => {
          await orgs.create(workspaceId, login, trx);
          throw failure;
        }),
      ).rejects.toBe(failure);

      // The insert succeeded and was then undone — which is the whole point of the helper,
      // and the thing a `begin`/`commit` written by hand at each call site gets wrong.
      await expect(orgs.findByLogin(login)).resolves.toBeUndefined();
    });

    it("rolls back a whole unit of work, not only the last statement", async () => {
      const login = uniqueName();

      await expect(
        database.transaction(async (trx) => {
          const org = await orgs.create(workspaceId, login, trx);
          await trx.insertInto("github_repos").values({ org_id: org.id, name: "helios" }).execute();
          // A constraint violation, raised by the database rather than by the test: the same
          // repository twice trips `github_repos_org_name_key`.
          await trx.insertInto("github_repos").values({ org_id: org.id, name: "helios" }).execute();
        }),
      ).rejects.toThrow();

      await expect(orgs.findByLogin(login)).resolves.toBeUndefined();
      const repos = await database.db
        .selectFrom("github_repos")
        .select("name")
        .where("name", "=", "helios")
        .execute();
      expect(repos).toEqual([]);
    });
  });

  describe("the schema this module mirrors", () => {
    /**
     * The migrated schema, as `information_schema` reports it.
     *
     * @returns Column names by table, for the schema the migrations own.
     */
    async function migratedColumns(): Promise<Map<string, Set<string>>> {
      const { rows } = await sql<{ table_name: string; column_name: string }>`
        select table_name, column_name
        from information_schema.columns
        where table_schema = ${SCHEMA_NAME}
        order by table_name, ordinal_position
      `.execute(database.db);

      const columns = new Map<string, Set<string>>();
      for (const { table_name, column_name } of rows) {
        const existing = columns.get(table_name) ?? new Set<string>();
        existing.add(column_name);
        columns.set(table_name, existing);
      }

      return columns;
    }

    it.each(TABLE_NAMES)("declares exactly the columns %s really has", async (table) => {
      // The check the whole file exists for. `schema.spec.ts` proves TABLE_COLUMNS matches
      // the TypeScript interfaces; this proves it matches the database. Together they are
      // what makes "the types mirror the migrations" something CI can fail on, rather than
      // something a reviewer has to notice.
      const migrated = await migratedColumns();

      expect(migrated.get(table)).toEqual(new Set(TABLE_COLUMNS[table]));
    });

    it("finds every table it declares", async () => {
      const migrated = await migratedColumns();

      expect(TABLE_NAMES.filter((table) => !migrated.has(table))).toEqual([]);
    });
  });

  describe("shutting down", () => {
    it("gives every connection back to the database", async () => {
      // The acceptance criterion, watched from PostgreSQL's side. `close()` is exactly what
      // Nest's SIGTERM listener calls — `src/application.ts` enables the hooks that
      // register it — so this is the drain the signal produces, minus the signal.
      const baseline = await serviceConnections();
      const shuttingDown = await application();
      const service = shuttingDown.get(DatabaseService);

      await service.db.selectFrom("organization").select("id").limit(1).execute();
      expect(await serviceConnections()).toBeGreaterThan(baseline);

      await shuttingDown.close();

      expect(await drainedTo(baseline)).toBe(baseline);
    });

    it("drains a pool that never opened a connection", async () => {
      // The other path through `end()`: Kysely takes the pool lazily, so a process that
      // shut down before its first query leaves one for this provider to close itself.
      const neverUsed = await application();

      await expect(neverUsed.close()).resolves.toBeUndefined();
    });
  });
});
