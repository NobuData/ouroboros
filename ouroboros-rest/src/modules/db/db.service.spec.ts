import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";

import { ConfigurationModule } from "../config/config.module";
import { DEVELOPMENT_ENVIRONMENT, testConfiguration } from "../config/configuration.fixture";
import { DbModule } from "./db.module";
import { DatabaseService } from "./db.service";
import { poolOptions } from "./pool";

/**
 * The lifecycle of the service's connection: what it opens, and that it closes it.
 *
 * `pg` is mocked rather than pointed at a database. What is worth asserting without one is
 * the wiring and the shutdown path — that the pool is built from the configured URL, that
 * an idle connection dropping is *logged* rather than thrown, and that the pool is drained
 * once and only once however the shutdown arrives. That last one is the issue's third
 * acceptance criterion; `db.integration-spec.ts` is where the same drain is watched from
 * PostgreSQL's side, against a real database.
 */

jest.mock("pg");

/** The mocked constructor, typed so its arguments and instances can be read. */
const PoolMock = jest.mocked(Pool);

/** The development `OURO_DATABASE_URL`, which is what the provider should connect with. */
const DEVELOPMENT_URL = DEVELOPMENT_ENVIRONMENT.OURO_DATABASE_URL;

/**
 * The provider, resolved the way `DbModule` resolves it.
 *
 * Built through the injector rather than with `new` so this also fails if the class stops
 * being satisfiable from what the module provides.
 *
 * @param nodeEnv - Which environment to configure. Only the query logging reads it.
 * @returns The database provider, over the mocked `pg.Pool`.
 */
async function databaseService(nodeEnv = "development"): Promise<DatabaseService> {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigurationModule.forRoot(testConfiguration({ NODE_ENV: nodeEnv })), DbModule],
  }).compile();

  return moduleRef.get(DatabaseService);
}

/**
 * The mocked `pg.Pool`, as the parts this provider uses.
 *
 * Typed as plain mock properties rather than as `jest.Mocked<Pool>` so a test can hand
 * `pool.end` to `expect` without the linter reading it as a method torn off its receiver —
 * which is what it would be, if these were methods rather than automocks.
 */
interface MockedPool {
  end: jest.Mock<Promise<void>, []>;
  on: jest.Mock<void, [string, (error: Error) => void]>;
  ending: boolean;
}

/**
 * The `pg.Pool` the provider constructed.
 *
 * @returns The single mocked instance, whose methods are mock functions.
 */
function constructedPool(): MockedPool {
  const [instance] = PoolMock.mock.instances;

  return instance as unknown as MockedPool;
}

/**
 * The handler the provider registered for `pg`'s `error` event.
 *
 * @returns The listener, which a test can then fire the way `pg` would.
 */
function idleErrorHandler(): (error: Error) => void {
  const registration = constructedPool().on.mock.calls.find(([event]) => event === "error");

  expect(registration).toBeDefined();
  return registration![1];
}

describe("DatabaseService", () => {
  it("builds its pool from the configured URL", async () => {
    await databaseService();

    expect(PoolMock).toHaveBeenCalledWith(poolOptions(DEVELOPMENT_URL));
  });

  it("exposes a query builder", async () => {
    const database = await databaseService();

    // Compiled rather than executed — there is no database here. What this asserts is that
    // the instance is wired to the PostgreSQL dialect and schema-qualifies its tables,
    // which is the difference between a query that finds a table and one that does not.
    const { sql } = database.db.selectFrom("tenants").select("slug").compile();

    expect(sql).toBe('select "slug" from "ouroboros"."tenants"');
  });

  it("qualifies every table with the schema Flyway owns", async () => {
    const database = await databaseService();

    const { sql } = database.db
      .insertInto("github_repos")
      .values({ org_id: "00000000-0000-0000-0000-000000000000", name: "ouroboros" })
      .compile();

    expect(sql).toContain('insert into "ouroboros"."github_repos"');
  });

  it("closes the pool", async () => {
    const database = await databaseService();

    await database.end();

    expect(constructedPool().end).toHaveBeenCalledTimes(1);
  });

  it("drains on shutdown, which is what the application's hooks are enabled for", async () => {
    const database = await databaseService();

    await database.onApplicationShutdown();

    expect(constructedPool().end).toHaveBeenCalledTimes(1);
  });

  it("closes it once, however many times it is asked", async () => {
    // `pg` rejects a second end() with "Called end on pool more than once", and a shutdown
    // path is precisely where something gets closed twice — an orchestrator that sends
    // SIGTERM twice, or a test that closes an application a hook also closes.
    const database = await databaseService();

    await database.end();
    await database.onApplicationShutdown();

    expect(constructedPool().end).toHaveBeenCalledTimes(1);
  });

  it("leaves the pool alone when Kysely has already closed it", async () => {
    // The two drain paths are exclusive: `PostgresDialect` ends the pool it was given once
    // it has taken one, and `pool.ending` is how this provider knows it did.
    const database = await databaseService();
    constructedPool().ending = true;

    await database.end();

    expect(constructedPool().end).not.toHaveBeenCalled();
  });

  it("drains through Nest, on the hook the process registers for SIGTERM", async () => {
    // The end of the acceptance criterion a unit test can reach: Nest's shutdown listener
    // calls `close()`, which is what invokes `onApplicationShutdown` on every provider.
    // That the listener is registered at all is `src/application.ts`'s job, asserted in
    // `application.spec.ts`; that a real database sees the connections go is the
    // integration suite's.
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), DbModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    await app.close();

    expect(constructedPool().end).toHaveBeenCalledTimes(1);
  });

  it("survives an idle connection dropping, and says so", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    await databaseService();

    // What `pg` does when the database restarts under a connection nobody is using.
    // Without the listener this is an unhandled `error` event, which ends the process — so
    // the assertion is that it does not throw as much as that it logs.
    expect(() => idleErrorHandler()(new Error("connection terminated"))).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("connection terminated"));
  });

  describe("transaction", () => {
    it("hands the caller a transaction and returns what the work returned", async () => {
      const database = await databaseService();
      const execute = jest.fn().mockResolvedValue("committed");
      jest
        .spyOn(database.db, "transaction")
        .mockReturnValue({ execute } as unknown as ReturnType<typeof database.db.transaction>);

      const work = jest.fn().mockResolvedValue("committed");
      await expect(database.transaction(work)).resolves.toBe("committed");

      expect(execute).toHaveBeenCalledWith(work);
    });

    it("lets a failure through, so the transaction rolls back", async () => {
      const database = await databaseService();
      const failure = new Error("duplicate key value violates unique constraint");
      const execute = jest.fn().mockRejectedValue(failure);
      jest
        .spyOn(database.db, "transaction")
        .mockReturnValue({ execute } as unknown as ReturnType<typeof database.db.transaction>);

      await expect(database.transaction(async () => Promise.resolve())).rejects.toBe(failure);
    });
  });
});
