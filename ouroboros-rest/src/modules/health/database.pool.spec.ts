import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";

import { SERVICE_NAME } from "../../version";
import { ConfigurationModule } from "../config/config.module";
import { DEVELOPMENT_ENVIRONMENT, testConfiguration } from "../config/configuration.fixture";
import { DatabaseProbePool, PROBE_STATEMENT, probePoolOptions } from "./database.pool";
import { PROBE_TIMEOUT_MS } from "./probe";
import { connectionRefused } from "./probe.fixture";

/**
 * The probe's own connection: how it is bounded, and what it does when it breaks.
 *
 * `pg` is mocked rather than pointed at a database. What is worth asserting here is the
 * configuration and the lifecycle — that no wait is unbounded, that the pool is closed once
 * and only once, and that an idle connection dropping is *logged* rather than thrown, which
 * is the difference between a probe that survives a database restart and a process that
 * does not. Whether PostgreSQL really answers `SELECT 1` is the integration suite's question
 * ([#37](https://github.com/NobuData/ouroboros/issues/37)).
 */

jest.mock("pg");

/** The mocked constructor, typed so its arguments and instances can be read. */
const PoolMock = jest.mocked(Pool);

/** The development `OURO_DATABASE_URL`, which is what the provider should connect with. */
const DEVELOPMENT_URL = DEVELOPMENT_ENVIRONMENT.OURO_DATABASE_URL;

/**
 * The provider, resolved the way the module resolves it.
 *
 * Built through the injector rather than with `new` so this also fails if the class stops
 * being satisfiable from what `HealthModule` provides.
 *
 * @returns The pool provider, over the mocked `pg.Pool`.
 */
async function probePool(): Promise<DatabaseProbePool> {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigurationModule.forRoot(testConfiguration())],
    providers: [DatabaseProbePool],
  }).compile();

  return moduleRef.get(DatabaseProbePool);
}

/**
 * The mocked `pg.Pool`, as the three functions this provider uses.
 *
 * Typed as plain mock properties rather than as `jest.Mocked<Pool>` so a test can hand
 * `pool.end` to `expect` without the linter reading it as a method torn off its receiver —
 * which is what it would be, if these were methods rather than automocks.
 */
interface MockedPool {
  query: jest.Mock<Promise<unknown>, [string]>;
  end: jest.Mock<Promise<void>, []>;
  on: jest.Mock<void, [string, (error: Error) => void]>;
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

describe("probePoolOptions", () => {
  const options = probePoolOptions(DEVELOPMENT_URL);

  it("connects with the URL the configuration validated", () => {
    expect(options.connectionString).toBe(DEVELOPMENT_URL);
  });

  it("holds one connection, so a probe never competes with request traffic", () => {
    expect(options.max).toBe(1);
  });

  it.each([
    ["getting a connection", "connectionTimeoutMillis"],
    ["waiting for rows", "query_timeout"],
    ["the server running the statement", "statement_timeout"],
  ] as const)("bounds %s", (_description, option) => {
    // The issue's third acceptance criterion is that ready never hangs. Every phase of the
    // wait, not just the one that is easy to remember.
    expect(options[option]).toBe(PROBE_TIMEOUT_MS);
  });

  it("says who opened the connection, for whoever reads pg_stat_activity", () => {
    expect(options.application_name).toContain(SERVICE_NAME);
  });
});

describe("DatabaseProbePool", () => {
  it("builds its pool from the configured URL", async () => {
    await probePool();

    expect(PoolMock).toHaveBeenCalledWith(probePoolOptions(DEVELOPMENT_URL));
  });

  it("runs the statement it was given", async () => {
    const pool = await probePool();

    await pool.query(PROBE_STATEMENT);

    expect(constructedPool().query).toHaveBeenCalledWith(PROBE_STATEMENT);
  });

  it("lets the driver's failure through, for the indicator to classify", async () => {
    const pool = await probePool();
    const refused = connectionRefused();
    constructedPool().query.mockRejectedValue(refused);

    await expect(pool.query(PROBE_STATEMENT)).rejects.toBe(refused);
  });

  it("closes the pool", async () => {
    const pool = await probePool();

    await pool.end();

    expect(constructedPool().end).toHaveBeenCalledTimes(1);
  });

  it("drains on shutdown, which is what the application's hooks are enabled for", async () => {
    const pool = await probePool();

    await pool.onApplicationShutdown();

    expect(constructedPool().end).toHaveBeenCalledTimes(1);
  });

  it("closes it once, however many times it is asked", async () => {
    // `pg` rejects a second end() with "Called end on pool more than once", and a shutdown
    // path is precisely where something gets closed twice.
    const pool = await probePool();

    await pool.end();
    await pool.onApplicationShutdown();

    expect(constructedPool().end).toHaveBeenCalledTimes(1);
  });

  it("survives an idle connection dropping, and says so", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    await probePool();

    // What `pg` does when the database restarts under a connection nobody is using. Without
    // the listener this is an unhandled `error` event, which ends the process — so the
    // assertion is that it does not throw as much as that it logs.
    expect(() => idleErrorHandler()(connectionRefused())).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED"));
  });
});
