import { SERVICE_NAME } from "../../version";
import { DEVELOPMENT_ENVIRONMENT } from "../config/configuration.fixture";
import {
  CONNECTION_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  MAX_POOL_CONNECTIONS,
  STATEMENT_TIMEOUT_MS,
  poolOptions,
} from "./pool";
import { SCHEMA_NAME } from "./schema";

/**
 * How the request pool is bounded.
 *
 * Every limit here is one that is otherwise only observable by overloading a real
 * PostgreSQL or by unplugging one — so it is asserted on the options object instead, which
 * is the reason `poolOptions` is a function rather than a literal at the `new Pool(…)` call
 * site.
 */

/** The development `OURO_DATABASE_URL`, which is what the service connects with. */
const DEVELOPMENT_URL = DEVELOPMENT_ENVIRONMENT.OURO_DATABASE_URL;

describe("poolOptions", () => {
  const options = poolOptions(DEVELOPMENT_URL);

  it("connects with the URL the configuration validated", () => {
    expect(options.connectionString).toBe(DEVELOPMENT_URL);
  });

  it("holds no more connections than the database's budget allows for", () => {
    expect(options.max).toBe(MAX_POOL_CONNECTIONS);
    // PostgreSQL's default max_connections is 100, shared with Flyway, the readiness
    // probe, a psql and any second replica of this service. A pool that could grow past a
    // tenth of it would exhaust the server rather than queue against itself.
    expect(MAX_POOL_CONNECTIONS).toBeLessThanOrEqual(10);
  });

  it("gives an idle connection back rather than holding it overnight", () => {
    expect(options.idleTimeoutMillis).toBe(IDLE_TIMEOUT_MS);
  });

  it.each([
    ["getting a connection from the pool", "connectionTimeoutMillis", CONNECTION_TIMEOUT_MS],
    ["waiting for rows on the client", "query_timeout", STATEMENT_TIMEOUT_MS],
    ["the server running the statement", "statement_timeout", STATEMENT_TIMEOUT_MS],
  ] as const)("bounds %s", (_description, option, expected) => {
    // Every phase of the wait, not just the one that is easy to remember: a request that
    // hangs is a worker that never returns, and a service with ten of those is down.
    expect(options[option]).toBe(expected);
  });

  it("says who opened the connection, for whoever reads pg_stat_activity", () => {
    expect(options.application_name).toBe(SERVICE_NAME);
  });

  it("is distinguishable there from the readiness probe's own connection", () => {
    // The probe names itself `ouroboros-rest health probe`. Two pools answering two
    // different questions are worth telling apart when one of them is holding connections.
    expect(options.application_name).not.toContain("probe");
  });

  it("puts the Flyway-owned schema on the search path, for raw fragments", () => {
    expect(options.options).toBe(`-c search_path=${SCHEMA_NAME},public`);
  });
});
