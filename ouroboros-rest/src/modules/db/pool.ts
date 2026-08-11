/**
 * How the service's connection pool is bounded.
 *
 * A function returning options rather than four arguments at a `new Pool(…)` call site, so
 * what bounds the pool is one readable thing a suite can assert on without a database
 * being involved — the same shape `src/modules/health/database.pool.ts` uses for the
 * readiness probe's pool, and for the same reason: a limit that is only observable by
 * overloading PostgreSQL is a limit nothing checks.
 *
 * This is the **request** pool. The readiness probe keeps a separate single-connection
 * pool of its own, deliberately: a probe sharing this one would be the first thing to fail
 * when this one was merely *busy*, which reports a load problem as a dependency outage —
 * and readiness is the signal an orchestrator uses to decide whether to keep sending
 * traffic. Two pools, two questions.
 */

import type { PoolConfig } from "pg";

import { SERVICE_NAME } from "../../version";
import { SCHEMA_NAME } from "./schema";

/**
 * Most connections this service will hold open at once.
 *
 * `pg`'s own default, restated because it is a decision rather than a value to inherit:
 * PostgreSQL's `max_connections` is 100 by default and is shared with every other client —
 * Flyway, a `psql`, the readiness probe, a second replica of this service — so a pool that
 * grew freely would exhaust the server rather than queue against itself. Requests beyond
 * this wait for a connection, bounded by {@link CONNECTION_TIMEOUT_MS}, which is the
 * failure mode worth having: a slow request rather than a database that stops accepting
 * anyone.
 */
export const MAX_POOL_CONNECTIONS = 10;

/**
 * How long an unused connection is kept before it is closed.
 *
 * Long enough that a normally-loaded service is not reconnecting between requests, short
 * enough that an idle process gives its connections back to the server rather than holding
 * a tenth of the connection budget overnight.
 */
export const IDLE_TIMEOUT_MS = 30_000;

/**
 * How long a caller waits for a connection from the pool before giving up.
 *
 * Without this, a pool that has reached {@link MAX_POOL_CONNECTIONS} against a database
 * that has stopped answering queues every request forever, and the service reports nothing
 * at all. With it, the request fails and says why.
 */
export const CONNECTION_TIMEOUT_MS = 5_000;

/**
 * How long any one statement may run.
 *
 * Set on both sides on purpose. `statement_timeout` is PostgreSQL's own, so the *server*
 * stops doing the work — a client that merely gave up would leave the query running and
 * the connection held. `query_timeout` is the client's, which is what bounds the wait when
 * the server has become unreachable rather than slow.
 *
 * Fifteen seconds is chosen against a person waiting on an HTTP response: anything this
 * service does for a request that takes longer is a query to fix, not a query to wait for.
 */
export const STATEMENT_TIMEOUT_MS = 15_000;

/**
 * Options for the service's `pg` pool.
 *
 * @param databaseUrl - `OURO_DATABASE_URL`, already validated by the configuration schema
 *   (`src/modules/config/configuration.ts`). Passed in rather than read, because nothing
 *   outside `src/modules/config/` names an environment variable.
 * @returns Options for a `pg.Pool`: bounded in size, bounded in every wait, named for this
 *   service in `pg_stat_activity`, and connected with `SCHEMA_NAME` on its `search_path`.
 */
export function poolOptions(databaseUrl: string): PoolConfig {
  return {
    connectionString: databaseUrl,

    max: MAX_POOL_CONNECTIONS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,

    // What `pg_stat_activity` calls these connections. Distinct from the readiness probe's
    // `ouroboros-rest health probe`, so "who is holding ten connections" has an answer.
    application_name: SERVICE_NAME,

    // Kysely's `WithSchemaPlugin` qualifies every statement it generates, so this is not
    // what makes the ordinary query find its table — it is what makes a raw `sql` fragment
    // find one, since the plugin rewrites the query tree and cannot see inside raw text.
    // `public` is kept behind it for anything an extension installed there provides.
    options: `-c search_path=${SCHEMA_NAME},public`,
  };
}
