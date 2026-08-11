/**
 * The one connection the readiness probe asks the database a question through.
 *
 * This is a *probe's* pool, not the service's. `ouroboros-rest` gets its typed data
 * access — a Kysely instance over a `pg` pool sized for request traffic — from
 * [#30](https://github.com/NobuData/ouroboros/issues/30), and when that lands this file
 * is what it replaces: the indicator beside it injects {@link DATABASE_PROBE_POOL}, so the
 * change is one provider in `health.module.ts` rather than anything in the probe.
 *
 * Until then it is deliberately the smallest pool that answers the question: one
 * connection, every wait bounded, and a `SELECT 1` that touches no table this service does
 * not own. A probe that shared the request pool would also be the first thing to fail when
 * the request pool was merely *busy* — which is a load problem reported as a dependency
 * outage, and the readiness signal an orchestrator reads to decide whether to keep sending
 * traffic.
 */

import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { Pool, type PoolConfig } from "pg";

import { SERVICE_NAME } from "../../version";
import { AppConfigService } from "../config/config.service";
import { PROBE_TIMEOUT_MS, describeForLog } from "./probe";

/**
 * The slice of a `pg.Pool` a connectivity probe uses.
 *
 * Two methods, so the indicator's suite can hand it a pool that answers, one that refuses
 * and one that never returns without a database being involved — and so
 * [#30](https://github.com/NobuData/ouroboros/issues/30) can satisfy this from its own
 * pool without the probe knowing.
 */
export interface ProbePool {
  /**
   * Run a statement and discard its rows.
   *
   * @param sql - The statement. The probe only ever sends {@link PROBE_STATEMENT}.
   * @returns Nothing — that the server answered at all is the whole result.
   */
  query(sql: string): Promise<void>;

  /**
   * Close every connection this pool holds.
   *
   * @returns When the pool is drained.
   */
  end(): Promise<void>;
}

/** Injection token for the {@link ProbePool} the database indicator queries through. */
export const DATABASE_PROBE_POOL = "HEALTH_DATABASE_PROBE_POOL";

/**
 * What the probe asks.
 *
 * `SELECT 1` is the whole question: it needs no schema, no table and no grant beyond
 * `CONNECT`, so it reports on the connection rather than on whether Flyway has run — which
 * is a different question, and one a probe answering `up`/`down` cannot usefully mix in.
 */
export const PROBE_STATEMENT = "SELECT 1";

/**
 * How the probe's pool is configured.
 *
 * A function rather than four arguments at the call site, so what bounds this pool is one
 * readable thing the suite can assert on without a database or a mocked driver — the
 * timeouts are the issue's third acceptance criterion, and a criterion that is only
 * observable by stopping PostgreSQL is one nothing checks.
 *
 * @param databaseUrl - `OURO_DATABASE_URL`, already validated by the configuration schema.
 * @returns Options for a `pg.Pool` that holds at most one connection and waits nowhere
 *   longer than {@link PROBE_TIMEOUT_MS}.
 */
export function probePoolOptions(databaseUrl: string): PoolConfig {
  return {
    connectionString: databaseUrl,

    // One connection. A probe asks one question at a time, and a pool that could grow
    // would compete with request traffic for the connection budget the database actually
    // has.
    max: 1,

    // Every phase has a deadline, and all three are needed because they bound different
    // things: getting a connection, waiting for rows on the client, and the server's own
    // willingness to keep running the statement. `withTimeout` in the indicator bounds the
    // *answer* on top of these; these are what stop an abandoned socket from outliving it.
    connectionTimeoutMillis: PROBE_TIMEOUT_MS,
    query_timeout: PROBE_TIMEOUT_MS,
    statement_timeout: PROBE_TIMEOUT_MS,

    // What `pg_stat_activity` will call this connection. A probe reconnecting every few
    // seconds is worth being able to name from the database's side.
    application_name: `${SERVICE_NAME} health probe`,
  };
}

/**
 * A single-connection `pg` pool, opened lazily and closed on shutdown.
 *
 * The class exists rather than a factory returning a bare `Pool` because a bare pool cannot
 * take part in the application's lifecycle: Nest calls `onApplicationShutdown` on a provider
 * *instance* that declares the method, and the thing that opened a socket is the thing that
 * should close it. `src/application.ts` enables the shutdown hooks that make that call
 * happen. Owning the pool is also what lets the `error` event below have a listener at all.
 */
@Injectable()
export class DatabaseProbePool implements ProbePool, OnApplicationShutdown {
  /** Where an idle-connection failure is reported. Named for the class, per Nest. */
  private readonly logger = new Logger(DatabaseProbePool.name);

  /** The pool itself. Constructed here; it connects on the first {@link query}. */
  private readonly pool: Pool;

  /**
   * Whether {@link end} has run.
   *
   * `pg` rejects a second `end()` with "Called end on pool more than once", and a shutdown
   * path is exactly where a provider gets closed twice — a test that closes an application
   * it also let a hook close, an orchestrator that sends `SIGTERM` twice. Shutting down is
   * the wrong moment to raise an unhandled rejection about shutting down.
   */
  private ended = false;

  /**
   * @param config - The typed configuration, for `OURO_DATABASE_URL`. Injected rather
   *   than read, because nothing outside `src/modules/config/` names an environment
   *   variable ([#28](https://github.com/NobuData/ouroboros/issues/28)).
   */
  constructor(config: AppConfigService) {
    this.pool = new Pool(probePoolOptions(config.databaseUrl));

    // Not optional: `pg` emits `error` on an *idle* client whose connection dropped — a
    // database restart, a failover, an idle timeout enforced by a proxy — and an
    // unhandled `error` event takes the process down. The probe is precisely the code
    // that must survive the database going away and report on it, so this swallows the
    // event and leaves a line in the log. The next `query` is what re-establishes the
    // connection, and its failure is what the response body reports.
    this.pool.on("error", (error) => {
      this.logger.warn(
        `the health probe's idle database connection failed: ${describeForLog(error)}`,
      );
    });
  }

  /**
   * Run a statement on the probe's connection.
   *
   * @param sql - The statement to run.
   * @returns Nothing; the rows are discarded.
   * @throws {Error} Whatever `pg` reported — a refused connection, a rejected login, a
   *   deadline. The indicator classifies it; see `probe.ts`.
   */
  async query(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  /**
   * Close the connection.
   *
   * @returns When the pool is drained. Safe on a pool that never connected — the normal
   *   case for a process that shut down before its first probe — and safe to call twice;
   *   see {@link ended}.
   */
  async end(): Promise<void> {
    if (this.ended) {
      return;
    }

    this.ended = true;
    await this.pool.end();
  }

  /**
   * Drain the pool as the application shuts down.
   *
   * @returns When the pool is drained, which Nest waits for before the process exits.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.end();
  }
}
