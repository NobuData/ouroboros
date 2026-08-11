/**
 * The service's connection to `ouroboros-db`: one pool, one Kysely instance, one lifecycle.
 *
 * Everything that reads or writes the tenancy schema goes through here. A repository does
 * not construct a pool, does not know the connection string, and does not decide when a
 * connection is returned — it takes this provider and issues typed queries against
 * {@link DatabaseService.db}.
 */

import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { Kysely, PostgresDialect, WithSchemaPlugin, type Transaction } from "kysely";
import { Pool } from "pg";

import { AppConfigService } from "../config/config.service";
import { queryLogger } from "./logging";
import { poolOptions } from "./pool";
import { SCHEMA_NAME, type Database } from "./schema";

/**
 * Typed, pooled access to the Flyway-owned schema.
 *
 * Four decisions are applied here and nowhere else:
 *
 *   * **The pool is owned by a provider, not by a module-level constant.** Nest calls
 *     `onApplicationShutdown` on a provider *instance*, and the thing that opened a socket
 *     is the thing that should close it. `src/application.ts` enables the shutdown hooks
 *     that make that call happen, so `SIGTERM` drains this pool before the process exits
 *     rather than leaving PostgreSQL to time the connections out.
 *   * **Every generated statement is schema-qualified.** `WithSchemaPlugin` rewrites the
 *     query tree, so `selectFrom("tenants")` compiles to `from "ouroboros"."tenants"` and
 *     the service does not depend on a `search_path` it did not set. The connection sets
 *     one anyway (see `pool.ts`), for the raw fragments the plugin cannot reach.
 *   * **Kysely is given the pool, and closes it.** `PostgresDialect` ends whatever pool it
 *     was handed when the instance is destroyed, so {@link end} destroys the Kysely
 *     instance rather than ending the pool behind its back — and then closes the pool
 *     itself only in the one case Kysely will not, which is a process that shut down
 *     before it ever ran a query.
 *   * **There is no `query(sql)` shortcut.** The typed builder is the interface. Anything
 *     that genuinely needs raw SQL uses Kysely's own `sql` template, which still
 *     parameterises — a method taking a string would be the one place in this service where
 *     an interpolated value reaches PostgreSQL as syntax.
 */
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  /** Where a dropped idle connection and a failed query are reported. Named per Nest. */
  private readonly logger = new Logger(DatabaseService.name);

  /** The connection pool. Constructed here; `pg` connects on the first query. */
  private readonly pool: Pool;

  /**
   * The typed query builder — the whole public surface of this module.
   *
   * `readonly` because a repository holds on to it: rebinding it under a live repository
   * would leave queries running against a pool nothing owns.
   */
  readonly db: Kysely<Database>;

  /**
   * Whether {@link end} has run.
   *
   * `pg` rejects a second `end()` with "Called end on pool more than once", and shutdown is
   * exactly where a provider gets closed twice — a test that closes an application a hook
   * also closes, an orchestrator that sends `SIGTERM` twice. Shutting down is the wrong
   * moment to raise an unhandled rejection about shutting down.
   */
  private ended = false;

  /**
   * @param config - The typed configuration, for `OURO_DATABASE_URL` and `NODE_ENV`.
   *   Injected rather than read, because nothing outside `src/modules/config/` names an
   *   environment variable ([#28](https://github.com/NobuData/ouroboros/issues/28)).
   */
  constructor(config: AppConfigService) {
    this.pool = new Pool(poolOptions(config.databaseUrl));

    // Not optional: `pg` emits `error` on an *idle* client whose connection dropped — a
    // database restart, a failover, an idle timeout enforced by a proxy — and an unhandled
    // `error` event takes the process down. Swallowing it and leaving a line in the log is
    // what lets the service survive a database restart; the pool reconnects on the next
    // query, and a query issued in the meantime fails on its own and says so.
    this.pool.on("error", (error) => {
      this.logger.warn(`an idle database connection failed: ${error.message}`);
    });

    this.db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: this.pool }),
      plugins: [new WithSchemaPlugin(SCHEMA_NAME)],
      log: queryLogger(this.logger, !config.isProduction),
    });
  }

  /**
   * Run several statements as one transaction.
   *
   * The helper exists so that "all of these or none of them" is one call rather than a
   * `begin`/`commit`/`rollback` sequence each caller writes correctly by hand. The
   * transaction commits when `work` resolves and rolls back if it throws — including on a
   * throw that is not an error, which is what makes an early `return` out of a callback
   * safe to express as one.
   *
   * The `trx` handed to `work` is a `Kysely<Database>` with the same typed surface, so a
   * repository method can take either and does not need to know which it was given.
   *
   * @param work - What to run inside the transaction. Every statement must go through the
   *   `trx` argument: one issued against {@link db} instead takes its own connection from
   *   the pool and is *not* part of the transaction — which is the one mistake this helper
   *   cannot prevent.
   * @returns Whatever `work` resolved to, once the transaction has committed.
   * @throws Whatever `work` threw, after the transaction has rolled back.
   */
  async transaction<T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(work);
  }

  /**
   * Close every connection this service holds.
   *
   * @returns When the pool is drained. Safe on a pool that never connected — the normal
   *   case for a process that shut down before its first query — and safe to call twice.
   */
  async end(): Promise<void> {
    if (this.ended) {
      return;
    }

    this.ended = true;

    // Destroying the Kysely instance is what ends the pool: `PostgresDialect` closes the
    // pool it was given. It does that only if it ever *took* it, which it does lazily on
    // the first query — so a process that never queried leaves the pool open, and the
    // second call is what closes it. `ending` is `pg`'s own flag, set the moment `end()`
    // is called, so the two paths cannot both fire.
    await this.db.destroy();

    if (!this.pool.ending) {
      await this.pool.end();
    }
  }

  /**
   * Drain the pool as the application shuts down.
   *
   * This is the acceptance criterion "clean pool drain on `SIGTERM`": Nest's shutdown
   * hooks — enabled in `src/application.ts` — listen for the signal and call this on every
   * provider that declares it, and the process does not exit until it resolves.
   *
   * @returns When the pool is drained.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.end();
  }
}
